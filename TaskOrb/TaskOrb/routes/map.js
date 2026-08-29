const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg, requireOrgApi } = require('../lib/org');
const { getBoardIdForList, getBoardPermission, atLeast } = require('../lib/access');
const { TEMPLATES, getTemplate } = require('../lib/templates');

const router = express.Router();

// Global map page: not tied to any one board, but scoped to the active
// organization. Loads every board in this org the user can add to
// (editor+) along with their lists, so the popup form can offer board/list
// pickers without extra round-trips.
router.get('/map', requireAuth, requireOrg, async (req, res) => {
  const isOrgAdmin = req.orgRole === 'admin';
  const { rows: boards } = await pool.query(
    isOrgAdmin
      ? `SELECT id, title, template FROM boards WHERE org_id = $1 ORDER BY created_at DESC`
      : `SELECT b.id, b.title, b.template FROM boards b
         JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $2 AND bm.permission IN ('owner','editor')
         WHERE b.org_id = $1
         ORDER BY b.created_at DESC`,
    isOrgAdmin ? [req.orgId] : [req.orgId, req.session.user.id]
  );

  const { rows: lists } = await pool.query(
    boards.length
      ? `SELECT id, board_id, name, position FROM lists WHERE board_id = ANY($1::int[]) ORDER BY position ASC`
      : `SELECT id, board_id, name, position FROM lists WHERE FALSE`,
    boards.length ? [boards.map((b) => b.id)] : []
  );

  // Every org-wide tag is usable on every board (including one created on
  // the spot from the popup); board-specific custom tags only apply to
  // that one board.
  const { rows: orgTags } = await pool.query(
    'SELECT id, name, color FROM tags WHERE org_id = $1 AND board_id IS NULL ORDER BY created_at ASC',
    [req.orgId]
  );
  const { rows: boardCustomTags } = await pool.query(
    boards.length
      ? `SELECT id, board_id, name, color FROM tags WHERE board_id = ANY($1::int[]) ORDER BY created_at ASC`
      : `SELECT id, board_id, name, color FROM tags WHERE FALSE`,
    boards.length ? [boards.map((b) => b.id)] : []
  );

  const boardsWithLists = boards.map((b) => ({
    ...b,
    lists: lists.filter((l) => l.board_id === b.id),
    tags: [...orgTags, ...boardCustomTags.filter((t) => t.board_id === b.id)]
  }));

  res.render('map', { boardsWithLists, orgTags, templates: TEMPLATES, currentUser: req.session.user });
});

// JSON: all prospects/cards with coordinates, across every board in the
// active org that the user can view.
router.get('/api/map-pins', requireAuth, requireOrgApi, async (req, res) => {
  try {
    const isOrgAdmin = req.orgRole === 'admin';
    const { rows } = await pool.query(
      isOrgAdmin
        ? `SELECT c.id, c.name, c.phone, c.address, c.lat, c.lng, c.notes,
                  l.id AS list_id, l.name AS list_name, b.id AS board_id, b.title AS board_title, u.name AS assigned_name
           FROM cards c
           JOIN lists l ON l.id = c.list_id
           JOIN boards b ON b.id = l.board_id
           LEFT JOIN users u ON u.id = c.assigned_to
           WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND b.org_id = $1
           ORDER BY c.created_at DESC`
        : `SELECT c.id, c.name, c.phone, c.address, c.lat, c.lng, c.notes,
                  l.id AS list_id, l.name AS list_name, b.id AS board_id, b.title AS board_title, u.name AS assigned_name
           FROM cards c
           JOIN lists l ON l.id = c.list_id
           JOIN boards b ON b.id = l.board_id
           JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $2
           LEFT JOIN users u ON u.id = c.assigned_to
           WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL AND b.org_id = $1
           ORDER BY c.created_at DESC`,
      isOrgAdmin ? [req.orgId] : [req.orgId, req.session.user.id]
    );

    // One extra query for every pin's tags, rather than N+1 per pin.
    const cardIds = rows.map((r) => r.id);
    let tagRows = [];
    if (cardIds.length > 0) {
      const { rows: fetchedTags } = await pool.query(
        `SELECT ct.card_id, t.id, t.name, t.color
         FROM card_tags ct JOIN tags t ON t.id = ct.tag_id
         WHERE ct.card_id = ANY($1::int[])
         ORDER BY t.created_at ASC`,
        [cardIds]
      );
      tagRows = fetchedTags;
    }
    const tagsByCard = {};
    tagRows.forEach((row) => {
      if (!tagsByCard[row.card_id]) tagsByCard[row.card_id] = [];
      tagsByCard[row.card_id].push({ id: row.id, name: row.name, color: row.color });
    });
    rows.forEach((r) => { r.tags = tagsByCard[r.id] || []; });

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load map pins.' });
  }
});

// Create a prospect/task from the map popup. Supports dropping it into an
// existing board+list, or creating either (or both) inline -- always
// within the currently active organization.
router.post('/api/map-pins', requireAuth, requireOrgApi, async (req, res) => {
  const { name, phone, address, lat, lng, notes, priority, tag_ids,
    board_id, new_board_title, new_board_template,
    list_id, new_list_name } = req.body;

  if (!name || !lat || !lng) return res.status(400).json({ error: 'Name and map location are required.' });
  if (!board_id && !new_board_title) return res.status(400).json({ error: 'Choose a board or name a new one.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let resolvedBoardId = board_id ? Number(board_id) : null;

    if (resolvedBoardId) {
      const permission = await getBoardPermission(req.session.user.id, resolvedBoardId, req.orgId, req.orgRole);
      if (!permission || !atLeast(permission, 'editor')) throw Object.assign(new Error('No permission on that board.'), { status: 403 });
    } else {
      const tpl = getTemplate(new_board_template);
      const { rows: boardRows } = await client.query(
        'INSERT INTO boards (org_id, title, template, owner_id) VALUES ($1,$2,$3,$4) RETURNING id',
        [req.orgId, new_board_title.trim(), new_board_template || 'blank', req.session.user.id]
      );
      resolvedBoardId = boardRows[0].id;
      await client.query("INSERT INTO board_members (board_id, user_id, permission) VALUES ($1,$2,'owner')", [resolvedBoardId, req.session.user.id]);
      for (let i = 0; i < tpl.lists.length; i++) {
        await client.query('INSERT INTO lists (board_id, name, position) VALUES ($1,$2,$3)', [resolvedBoardId, tpl.lists[i], i + 1]);
      }
    }

    let resolvedListId = list_id ? Number(list_id) : null;
    if (resolvedListId) {
      const listBoardId = await getBoardIdForList(resolvedListId);
      if (listBoardId !== resolvedBoardId) throw Object.assign(new Error('That list does not belong to the chosen board.'), { status: 400 });
    } else if (new_list_name && new_list_name.trim()) {
      const { rows: posRows } = await client.query('SELECT COALESCE(MAX(position),0)+1 AS next FROM lists WHERE board_id = $1', [resolvedBoardId]);
      const { rows: listRows } = await client.query(
        'INSERT INTO lists (board_id, name, position) VALUES ($1,$2,$3) RETURNING id',
        [resolvedBoardId, new_list_name.trim(), posRows[0].next]
      );
      resolvedListId = listRows[0].id;
    } else {
      // No list chosen -- default to the board's first list (by position).
      const { rows: firstList } = await client.query('SELECT id FROM lists WHERE board_id = $1 ORDER BY position ASC LIMIT 1', [resolvedBoardId]);
      if (!firstList[0]) throw Object.assign(new Error('That board has no lists yet -- add one first.'), { status: 400 });
      resolvedListId = firstList[0].id;
    }

    const { rows: cardPosRows } = await client.query('SELECT COALESCE(MAX(position),0)+1 AS next FROM cards WHERE list_id = $1', [resolvedListId]);
    const { rows: cardRows } = await client.query(
      `INSERT INTO cards (list_id, name, phone, address, lat, lng, notes, priority, assigned_to, created_by, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [resolvedListId, name.trim(), phone || null, address || null, lat, lng, notes || null,
        priority || 'warm', req.session.user.id, req.session.user.id, cardPosRows[0].next]
    );

    // Attach any tags selected in the popup -- validated against tags that
    // actually apply to the resolved board (org-wide or that board's own
    // custom tags), so a tampered request can't attach a foreign tag.
    const requestedTagIds = Array.isArray(tag_ids) ? tag_ids : (tag_ids ? [tag_ids] : []);
    if (requestedTagIds.length > 0) {
      const { rows: validTags } = await client.query(
        `SELECT id FROM tags WHERE id = ANY($1::int[]) AND org_id = $2 AND (board_id IS NULL OR board_id = $3)`,
        [requestedTagIds.map(Number), req.orgId, resolvedBoardId]
      );
      for (const t of validTags) {
        await client.query('INSERT INTO card_tags (card_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cardRows[0].id, t.id]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ card: cardRows[0], board_id: resolvedBoardId, list_id: resolvedListId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Could not save this prospect.' });
  } finally {
    client.release();
  }
});

// Best-effort reverse geocoding proxy (OpenStreetMap Nominatim) so the popup
// form can prefill an address from the tapped coordinates.
router.get('/api/reverse-geocode', requireAuth, async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'taskorb-prototype/1.0' } });
    const data = await resp.json();
    res.json({ address: data.display_name || '' });
  } catch (err) {
    res.json({ address: '' });
  }
});

module.exports = router;
