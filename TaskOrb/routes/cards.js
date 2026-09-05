const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrgApi } = require('../lib/org');
const { getBoardIdForList, getBoardIdForCard, getBoardPermission, atLeast } = require('../lib/access');
const { notify } = require('../lib/notify');

const router = express.Router();

// Attachments are stored in Postgres (bytea), not local disk -- see schema.sql
// note on why. Cap size so a single upload can't blow up the database.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 }, // 20MB/file, 5 files per request
  fileFilter: (req, file, cb) => {
    const allowed = /^(image\/|application\/pdf$|video\/mp4$|video\/quicktime$)/;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
});

async function requireCardEditor(req, res, next) {
  try {
    const boardId = await getBoardIdForCard(req.params.id || req.params.cardId);
    if (!boardId) return res.status(404).json({ error: 'Card not found.' });
    const permission = await getBoardPermission(req.session.user.id, boardId, req.orgId, req.orgRole);
    if (!permission || !atLeast(permission, 'editor')) return res.status(403).json({ error: 'No permission.' });
    req.cardBoardId = boardId;
    req.cardPermission = permission;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify access.' });
  }
}

// --- Quick-add a card directly on the board (no map needed) ---
router.post('/lists/:id/cards', requireAuth, requireOrgApi, async (req, res) => {
  try {
    const boardId = await getBoardIdForList(req.params.id);
    if (!boardId) return res.status(404).json({ error: 'List not found.' });
    const permission = await getBoardPermission(req.session.user.id, boardId, req.orgId, req.orgRole);
    if (!permission || !atLeast(permission, 'editor')) return res.status(403).json({ error: 'No permission.' });

    const { name, phone, notes, priority } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });

    const { rows: posRows } = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS next FROM cards WHERE list_id = $1', [req.params.id]);
    const { rows } = await pool.query(
      `INSERT INTO cards (list_id, name, phone, notes, priority, created_by, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, name.trim(), phone || null, notes || null, priority || 'warm', req.session.user.id, posRows[0].next]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create card.' });
  }
});

// --- Move a card to a new list / position (drag & drop) ---
router.patch('/api/cards/:id/move', requireAuth, requireOrgApi, requireCardEditor, async (req, res) => {
  const { list_id, position } = req.body;
  try {
    // Guard against dragging a card into a list from a different board.
    const targetBoardId = await getBoardIdForList(list_id);
    if (targetBoardId !== req.cardBoardId) return res.status(400).json({ error: 'Cannot move a card to a different board.' });

    const { rows: before } = await pool.query('SELECT name, assigned_to FROM cards WHERE id = $1', [req.params.id]);
    const { rows: listRow } = await pool.query('SELECT name FROM lists WHERE id = $1', [list_id]);

    await pool.query('UPDATE cards SET list_id = $1, position = $2, updated_at = NOW() WHERE id = $3', [list_id, position, req.params.id]);

    if (before[0] && before[0].assigned_to && before[0].assigned_to !== req.session.user.id) {
      await notify(
        before[0].assigned_to,
        req.orgId,
        `${req.session.user.name} moved "${before[0].name}" to ${listRow[0] ? listRow[0].name : 'another list'}.`,
        `/boards/${req.cardBoardId}`
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not move card.' });
  }
});

// --- Edit card details ---
router.patch('/api/cards/:id', requireAuth, requireOrgApi, requireCardEditor, async (req, res) => {
  const { name, phone, email, address, notes, priority, assigned_to } = req.body;
  try {
    const { rows: before } = await pool.query('SELECT name, assigned_to FROM cards WHERE id = $1', [req.params.id]);

    const { rows } = await pool.query(
      `UPDATE cards SET
        name = COALESCE($1, name),
        phone = $2,
        email = $3,
        address = $4,
        notes = $5,
        priority = COALESCE($6, priority),
        assigned_to = $7,
        updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [name, phone || null, email || null, address || null, notes || null, priority, assigned_to || null, req.params.id]
    );

    const newAssignee = assigned_to ? Number(assigned_to) : null;
    if (newAssignee && newAssignee !== before[0].assigned_to && newAssignee !== req.session.user.id) {
      await notify(newAssignee, req.orgId, `${req.session.user.name} assigned you to "${rows[0].name}".`, `/boards/${req.cardBoardId}`);
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update card.' });
  }
});

router.delete('/api/cards/:id', requireAuth, requireOrgApi, requireCardEditor, async (req, res) => {
  try {
    await pool.query('DELETE FROM cards WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete card.' });
  }
});

// --- Card tags (attach/detach; a card can carry several at once) ---
router.post('/api/cards/:id/tags', requireAuth, requireOrgApi, requireCardEditor, async (req, res) => {
  const { tag_id } = req.body;
  if (!tag_id) return res.status(400).json({ error: 'tag_id is required.' });
  try {
    // The tag must actually be usable on this card's board -- either
    // org-wide, or a custom tag created specifically for this board.
    const { rows: tagRows } = await pool.query(
      `SELECT id FROM tags
       WHERE id = $1 AND org_id = $2 AND (board_id IS NULL OR board_id = $3)
       LIMIT 1`,
      [tag_id, req.orgId, req.cardBoardId]
    );
    if (!tagRows[0]) return res.status(400).json({ error: 'That tag is not available on this board.' });

    await pool.query('INSERT INTO card_tags (card_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, tag_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add tag.' });
  }
});

router.delete('/api/cards/:id/tags/:tagId', requireAuth, requireOrgApi, requireCardEditor, async (req, res) => {
  try {
    await pool.query('DELETE FROM card_tags WHERE card_id = $1 AND tag_id = $2', [req.params.id, req.params.tagId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not remove tag.' });
  }
});

// --- Card cover photo (picked from the card's own image attachments) ---
router.post('/api/cards/:id/cover', requireAuth, requireOrgApi, requireCardEditor, async (req, res) => {
  const { attachment_id } = req.body;
  try {
    if (attachment_id) {
      const { rows } = await pool.query(
        "SELECT id FROM card_attachments WHERE id = $1 AND card_id = $2 AND mime_type LIKE 'image/%'",
        [attachment_id, req.params.id]
      );
      if (!rows[0]) return res.status(400).json({ error: 'That attachment is not an image on this card.' });
    }
    await pool.query('UPDATE cards SET cover_attachment_id = $1 WHERE id = $2', [attachment_id || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not set cover photo.' });
  }
});

// --- Attachments ---
router.get('/api/cards/:id/attachments', requireAuth, requireOrgApi, async (req, res) => {
  try {
    const boardId = await getBoardIdForCard(req.params.id);
    if (!boardId) return res.status(404).json({ error: 'Card not found.' });
    const permission = await getBoardPermission(req.session.user.id, boardId, req.orgId, req.orgRole);
    if (!permission) return res.status(403).json({ error: 'No permission.' });

    const { rows } = await pool.query(
      'SELECT id, filename, mime_type, size_bytes, created_at FROM card_attachments WHERE card_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load attachments.' });
  }
});

router.post('/api/cards/:id/attachments', requireAuth, requireOrgApi, requireCardEditor, upload.array('files', 5), async (req, res) => {
  try {
    const files = req.files || [];
    const saved = [];
    for (const file of files) {
      const { rows } = await pool.query(
        `INSERT INTO card_attachments (card_id, filename, mime_type, size_bytes, data, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, filename, mime_type, size_bytes, created_at`,
        [req.params.id, file.originalname, file.mimetype, file.size, file.buffer, req.session.user.id]
      );
      saved.push(rows[0]);
    }
    res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Could not upload file.' });
  }
});

router.get('/api/attachments/:id', requireAuth, requireOrgApi, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, l.board_id FROM card_attachments a
       JOIN cards c ON c.id = a.card_id
       JOIN lists l ON l.id = c.list_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).send('Not found.');
    const permission = await getBoardPermission(req.session.user.id, rows[0].board_id, req.orgId, req.orgRole);
    if (!permission) return res.status(403).send('No permission.');

    res.setHeader('Content-Type', rows[0].mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${rows[0].filename.replace(/"/g, '')}"`);
    res.send(rows[0].data);
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not load file.');
  }
});

router.delete('/api/attachments/:id', requireAuth, requireOrgApi, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.board_id FROM card_attachments a
       JOIN cards c ON c.id = a.card_id
       JOIN lists l ON l.id = c.list_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
    const permission = await getBoardPermission(req.session.user.id, rows[0].board_id, req.orgId, req.orgRole);
    if (!permission || !atLeast(permission, 'editor')) return res.status(403).json({ error: 'No permission.' });

    await pool.query('DELETE FROM card_attachments WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete attachment.' });
  }
});

module.exports = router;
