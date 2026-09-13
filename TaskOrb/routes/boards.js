const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg, requireOrgApi } = require('../lib/org');
const { requireBoardAccess, getBoardIdForList, getBoardPermission, atLeast } = require('../lib/access');
const { notify } = require('../lib/notify');
const { TEMPLATES, getTemplate } = require('../lib/templates');

const router = express.Router();

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Cover photo must be an image.'));
  }
});

async function loadBoardsForOrg(userId, orgId, orgRole) {
  const isOrgAdmin = orgRole === 'admin';
  const cols = `b.id, b.title, b.description, b.template, b.owner_id, b.cover_mime_type, b.created_at`;
  const { rows } = await pool.query(
    isOrgAdmin
      ? `SELECT ${cols}, u.name AS owner_name,
                (SELECT COUNT(*) FROM board_members m WHERE m.board_id = b.id) AS member_count,
                'owner' AS my_permission
         FROM boards b LEFT JOIN users u ON u.id = b.owner_id
         WHERE b.org_id = $1
         ORDER BY b.created_at DESC`
      : `SELECT ${cols}, u.name AS owner_name,
                (SELECT COUNT(*) FROM board_members m2 WHERE m2.board_id = b.id) AS member_count,
                bm.permission AS my_permission
         FROM boards b
         JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $2
         LEFT JOIN users u ON u.id = b.owner_id
         WHERE b.org_id = $1
         ORDER BY b.created_at DESC`,
    isOrgAdmin ? [orgId] : [orgId, userId]
  );
  return rows;
}

// --- Board index: every board in the active org this user is a member of (org admins see all) ---
router.get('/boards', requireAuth, requireOrg, async (req, res) => {
  const boards = await loadBoardsForOrg(req.session.user.id, req.orgId, req.orgRole);
  res.render('boards-index', { boards, templates: TEMPLATES, currentUser: req.session.user, error: null });
});

router.post('/boards', requireAuth, requireOrg, async (req, res) => {
  const { title, description, template } = req.body;
  if (!title || !title.trim()) {
    const boards = await loadBoardsForOrg(req.session.user.id, req.orgId, req.orgRole);
    return res.render('boards-index', { boards, templates: TEMPLATES, currentUser: req.session.user, error: 'Give the board a title.' });
  }

  const tpl = getTemplate(template);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: boardRows } = await client.query(
      'INSERT INTO boards (org_id, title, description, template, owner_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.orgId, title.trim(), description || null, template || 'blank', req.session.user.id]
    );
    const boardId = boardRows[0].id;
    await client.query(
      "INSERT INTO board_members (board_id, user_id, permission) VALUES ($1,$2,'owner')",
      [boardId, req.session.user.id]
    );
    for (let i = 0; i < tpl.lists.length; i++) {
      await client.query('INSERT INTO lists (board_id, name, position) VALUES ($1,$2,$3)', [boardId, tpl.lists[i], i + 1]);
    }
    await client.query('COMMIT');
    res.redirect(`/boards/${boardId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Could not create board.');
  } finally {
    client.release();
  }
});

// --- Board detail (the kanban view) ---
router.get('/boards/:id', requireAuth, requireOrg, requireBoardAccess('viewer'), async (req, res) => {
  const boardId = req.boardId;
  const { rows: boardRows } = await pool.query(
    'SELECT id, title, description, template, owner_id, cover_mime_type, created_at FROM boards WHERE id = $1',
    [boardId]
  );
  if (!boardRows[0]) return res.status(404).render('error', { title: 'Not found', message: 'That board does not exist.', currentUser: req.session.user });

  const { rows: lists } = await pool.query('SELECT id, name, position FROM lists WHERE board_id = $1 ORDER BY position ASC', [boardId]);
  const { rows: cards } = await pool.query(`
    SELECT c.*, u.name AS assigned_name,
           (SELECT COUNT(*) FROM card_attachments a WHERE a.card_id = c.id) AS attachment_count
    FROM cards c
    LEFT JOIN users u ON u.id = c.assigned_to
    JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = $1
    ORDER BY c.position ASC
  `, [boardId]);

  // Tags available on this board: every org-wide tag, plus any custom tag
  // created specifically for this board.
  const { rows: boardTags } = await pool.query(
    `SELECT id, name, color, board_id FROM tags WHERE org_id = $1 AND (board_id IS NULL OR board_id = $2) ORDER BY board_id NULLS FIRST, created_at ASC`,
    [req.orgId, boardId]
  );

  // Which tags are on which card, fetched once for the whole board rather
  // than per-card.
  const cardIds = cards.map((c) => c.id);
  let cardTagRows = [];
  if (cardIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT ct.card_id, t.id, t.name, t.color
       FROM card_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.card_id = ANY($1::int[])
       ORDER BY t.created_at ASC`,
      [cardIds]
    );
    cardTagRows = rows;
  }
  const tagsByCard = {};
  cardTagRows.forEach((row) => {
    if (!tagsByCard[row.card_id]) tagsByCard[row.card_id] = [];
    tagsByCard[row.card_id].push({ id: row.id, name: row.name, color: row.color });
  });
  cards.forEach((c) => { c.tags = tagsByCard[c.id] || []; });

  const { rows: members } = await pool.query(`
    SELECT bm.user_id, bm.permission, u.name, u.email
    FROM board_members bm JOIN users u ON u.id = bm.user_id
    WHERE bm.board_id = $1 ORDER BY bm.added_at ASC
  `, [boardId]);
  // Sharing is limited to people already in this organization -- never the
  // full global user list, or you could hand board access to someone
  // outside the org entirely.
  const { rows: allUsers } = await pool.query(
    `SELECT u.id, u.name, u.email FROM users u
     JOIN org_members om ON om.user_id = u.id
     WHERE om.org_id = $1 ORDER BY u.name ASC`,
    [req.orgId]
  );

  const board = lists.map((list) => ({ ...list, cards: cards.filter((c) => c.list_id === list.id) }));

  res.render('board', {
    boardMeta: boardRows[0],
    board,
    members,
    allUsers,
    boardTags,
    myPermission: req.boardPermission,
    currentUser: req.session.user
  });
});

router.patch('/boards/:id', requireAuth, requireOrgApi, requireBoardAccess('owner'), async (req, res) => {
  const { title, description } = req.body;
  const { rows } = await pool.query(
    'UPDATE boards SET title = COALESCE($1, title), description = $2 WHERE id = $3 RETURNING *',
    [title && title.trim() ? title.trim() : null, description || null, req.boardId]
  );
  res.json(rows[0]);
});

router.delete('/boards/:id', requireAuth, requireOrgApi, requireBoardAccess('owner'), async (req, res) => {
  try {
    await pool.query('DELETE FROM cards WHERE list_id IN (SELECT id FROM lists WHERE board_id = $1)', [req.boardId]);
    await pool.query('DELETE FROM boards WHERE id = $1', [req.boardId]); // cascades lists, board_members
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete board.' });
  }
});

// --- Cover photo ---
router.get('/boards/:id/cover', requireAuth, requireOrgApi, requireBoardAccess('viewer'), async (req, res) => {
  const { rows } = await pool.query('SELECT cover_mime_type, cover_data FROM boards WHERE id = $1', [req.boardId]);
  if (!rows[0] || !rows[0].cover_data) return res.status(404).send('No cover photo.');
  res.setHeader('Content-Type', rows[0].cover_mime_type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(rows[0].cover_data);
});

router.post('/boards/:id/cover', requireAuth, requireOrgApi, requireBoardAccess('owner'), coverUpload.single('cover'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
  try {
    await pool.query('UPDATE boards SET cover_mime_type = $1, cover_data = $2 WHERE id = $3', [req.file.mimetype, req.file.buffer, req.boardId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save cover photo.' });
  }
});

router.delete('/boards/:id/cover', requireAuth, requireOrgApi, requireBoardAccess('owner'), async (req, res) => {
  await pool.query('UPDATE boards SET cover_mime_type = NULL, cover_data = NULL WHERE id = $1', [req.boardId]);
  res.json({ ok: true });
});

// --- Reorder lists (drag-and-drop) ---
router.post('/boards/:id/lists/reorder', requireAuth, requireOrgApi, requireBoardAccess('editor'), async (req, res) => {
  const { order } = req.body; // array of list ids, in the desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of list ids.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < order.length; i++) {
      await client.query('UPDATE lists SET position = $1 WHERE id = $2 AND board_id = $3', [i + 1, order[i], req.boardId]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not reorder lists.' });
  } finally {
    client.release();
  }
});

// --- Sharing / members ---
router.post('/boards/:id/members', requireAuth, requireOrgApi, requireBoardAccess('owner'), async (req, res) => {
  const { user_id, permission } = req.body;
  if (!user_id || !['owner', 'editor', 'viewer'].includes(permission)) {
    return res.status(400).json({ error: 'A user and a valid permission are required.' });
  }
  try {
    // Only people already in this organization can be given board access.
    const { rows: memberCheck } = await pool.query(
      'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2',
      [req.orgId, user_id]
    );
    if (!memberCheck[0]) return res.status(400).json({ error: 'That person is not a member of this organization.' });

    await pool.query(
      `INSERT INTO board_members (board_id, user_id, permission) VALUES ($1,$2,$3)
       ON CONFLICT (board_id, user_id) DO UPDATE SET permission = $3`,
      [req.boardId, user_id, permission]
    );
    const { rows: boardRows } = await pool.query('SELECT title FROM boards WHERE id = $1', [req.boardId]);
    await notify(user_id, req.orgId, `${req.session.user.name} added you to "${boardRows[0].title}" as ${permission}.`, `/boards/${req.boardId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add that member.' });
  }
});

router.patch('/boards/:id/members/:userId', requireAuth, requireOrgApi, requireBoardAccess('owner'), async (req, res) => {
  const { permission } = req.body;
  if (!['owner', 'editor', 'viewer'].includes(permission)) return res.status(400).json({ error: 'Invalid permission.' });
  await pool.query('UPDATE board_members SET permission = $1 WHERE board_id = $2 AND user_id = $3', [permission, req.boardId, req.params.userId]);
  res.json({ ok: true });
});

router.delete('/boards/:id/members/:userId', requireAuth, requireOrgApi, requireBoardAccess('owner'), async (req, res) => {
  const { rows: owners } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM board_members WHERE board_id = $1 AND permission = 'owner'",
    [req.boardId]
  );
  const { rows: target } = await pool.query(
    'SELECT permission FROM board_members WHERE board_id = $1 AND user_id = $2',
    [req.boardId, req.params.userId]
  );
  if (target[0] && target[0].permission === 'owner' && owners[0].count <= 1) {
    return res.status(400).json({ error: "A board needs at least one owner." });
  }
  await pool.query('DELETE FROM board_members WHERE board_id = $1 AND user_id = $2', [req.boardId, req.params.userId]);
  res.json({ ok: true });
});

// --- Board-scoped custom tags (org-wide tags are managed from /tags) ---
router.post('/boards/:id/tags', requireAuth, requireOrgApi, requireBoardAccess('editor'), async (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Tag name is required.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO tags (org_id, board_id, name, color, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.orgId, req.boardId, name.trim(), color || '#3AA0E0', req.session.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create tag.' });
  }
});

// --- Lists (scoped to a board) ---
router.post('/boards/:id/lists', requireAuth, requireOrgApi, requireBoardAccess('editor'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'List name is required.' });
  const { rows: posRows } = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS next FROM lists WHERE board_id = $1', [req.boardId]);
  const { rows } = await pool.query(
    'INSERT INTO lists (board_id, name, position) VALUES ($1,$2,$3) RETURNING *',
    [req.boardId, name.trim(), posRows[0].next]
  );
  res.status(201).json(rows[0]);
});

router.patch('/lists/:id', requireAuth, requireOrgApi, async (req, res) => {
  try {
    const boardId = await getBoardIdForList(req.params.id);
    if (!boardId) return res.status(404).json({ error: 'List not found.' });
    const permission = await getBoardPermission(req.session.user.id, boardId, req.orgId, req.orgRole);
    if (!permission || !atLeast(permission, 'editor')) return res.status(403).json({ error: 'No permission.' });

    const { name } = req.body;
    const { rows } = await pool.query('UPDATE lists SET name = COALESCE($1, name) WHERE id = $2 RETURNING *', [name, req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not rename list.' });
  }
});

router.delete('/lists/:id', requireAuth, requireOrgApi, async (req, res) => {
  try {
    const boardId = await getBoardIdForList(req.params.id);
    if (!boardId) return res.status(404).json({ error: 'List not found.' });
    const permission = await getBoardPermission(req.session.user.id, boardId, req.orgId, req.orgRole);
    if (!permission || !atLeast(permission, 'editor')) return res.status(403).json({ error: 'No permission.' });

    await pool.query('DELETE FROM cards WHERE list_id = $1', [req.params.id]);
    await pool.query('DELETE FROM lists WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete list.' });
  }
});

module.exports = router;
