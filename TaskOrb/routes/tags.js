const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg, requireOrgApi, requireOrgRole } = require('../lib/org');
const { getBoardPermission, atLeast } = require('../lib/access');

const router = express.Router();

// --- Tag management page (admin only) ---
// A tag applies either to ONE board (board_id set -- it only ever appears
// on that board) or to every board in the org (board_id NULL, a paid-plan
// feature). Board-specific is the normal case; org-wide is the exception
// and has to be chosen on purpose.
async function renderTagsPage(req, res, error) {
  const { rows: tags } = await pool.query(
    `SELECT t.id, t.name, t.color, t.board_id, b.title AS board_title
     FROM tags t LEFT JOIN boards b ON b.id = t.board_id
     WHERE t.org_id = $1
     ORDER BY (t.board_id IS NOT NULL), b.title, t.created_at ASC`,
    [req.orgId]
  );
  const { rows: boards } = await pool.query('SELECT id, title FROM boards WHERE org_id = $1 ORDER BY title ASC', [req.orgId]);
  res.render('tags', {
    tags, boards,
    canOrgWide: !!(req.plan && req.plan.hasOrgTags),
    currentUser: req.session.user,
    error: error || null
  });
}

router.get('/tags', requireAuth, requireOrg, requireOrgRole('admin'), (req, res) => renderTagsPage(req, res, null));

router.post('/tags', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const { name, color, scope } = req.body;
  const cleanName = (name || '').trim();
  if (!cleanName) return renderTagsPage(req, res, 'Give the tag a name.');

  let boardId = null;
  if (scope === 'org') {
    if (!req.plan || !req.plan.hasOrgTags) {
      return renderTagsPage(req, res, 'Tags that apply to every board need a paid plan. Pick a specific board instead, or upgrade.');
    }
  } else {
    boardId = Number(scope);
    if (!Number.isInteger(boardId) || boardId <= 0) return renderTagsPage(req, res, 'Choose where this tag applies: a specific board, or every board.');
    const { rows } = await pool.query('SELECT 1 FROM boards WHERE id = $1 AND org_id = $2', [boardId, req.orgId]);
    if (!rows[0]) return renderTagsPage(req, res, 'That board was not found in this organization.');
  }

  const { rows: dup } = await pool.query(
    'SELECT 1 FROM tags WHERE org_id = $1 AND board_id IS NOT DISTINCT FROM $2 AND LOWER(name) = LOWER($3)',
    [req.orgId, boardId, cleanName]
  );
  if (dup[0]) return renderTagsPage(req, res, boardId ? 'That board already has a tag with this name.' : 'There is already an org-wide tag with this name.');

  await pool.query(
    'INSERT INTO tags (org_id, board_id, name, color, created_by) VALUES ($1, $2, $3, $4, $5)',
    [req.orgId, boardId, cleanName, color || '#3AA0E0', req.session.user.id]
  );
  res.redirect('/tags');
});

// --- Rename/recolor/delete a tag (works for both org-wide and board-scoped
// tags -- permission differs depending on which kind it is). ---
async function loadTagAndCheckAccess(req, res, minBoardPermission) {
  const { rows } = await pool.query('SELECT * FROM tags WHERE id = $1', [req.params.id]);
  const tag = rows[0];
  if (!tag || tag.org_id !== req.orgId) {
    res.status(404).json({ error: 'Tag not found.' });
    return null;
  }
  if (tag.board_id === null) {
    if (req.orgRole !== 'admin') {
      res.status(403).json({ error: 'Only an org admin can manage org-wide tags.' });
      return null;
    }
  } else {
    const permission = await getBoardPermission(req.session.user.id, tag.board_id, req.orgId, req.orgRole);
    if (!permission || !atLeast(permission, minBoardPermission)) {
      res.status(403).json({ error: 'No permission to manage this tag.' });
      return null;
    }
  }
  return tag;
}

router.patch('/tags/:id', requireAuth, requireOrgApi, async (req, res) => {
  const tag = await loadTagAndCheckAccess(req, res, 'editor');
  if (!tag) return;
  const { name, color } = req.body;
  const { rows } = await pool.query(
    'UPDATE tags SET name = COALESCE($1, name), color = COALESCE($2, color) WHERE id = $3 RETURNING *',
    [name && name.trim() ? name.trim() : null, color || null, tag.id]
  );
  res.json(rows[0]);
});

router.delete('/tags/:id', requireAuth, requireOrgApi, async (req, res) => {
  const tag = await loadTagAndCheckAccess(req, res, 'editor');
  if (!tag) return;
  await pool.query('DELETE FROM tags WHERE id = $1', [tag.id]); // cascades card_tags
  res.json({ ok: true });
});

module.exports = router;
