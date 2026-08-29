const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg, requireOrgApi, requireOrgRole } = require('../lib/org');
const { getBoardPermission, atLeast } = require('../lib/access');

const router = express.Router();

// --- Org-wide tag management page (admin only) ---
router.get('/tags', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const { rows: tags } = await pool.query(
    'SELECT id, name, color FROM tags WHERE org_id = $1 AND board_id IS NULL ORDER BY created_at ASC',
    [req.orgId]
  );
  res.render('tags', { tags, currentUser: req.session.user, error: null });
});

router.post('/tags', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) {
    const { rows: tags } = await pool.query('SELECT id, name, color FROM tags WHERE org_id = $1 AND board_id IS NULL ORDER BY created_at ASC', [req.orgId]);
    return res.render('tags', { tags, currentUser: req.session.user, error: 'Give the tag a name.' });
  }
  await pool.query(
    'INSERT INTO tags (org_id, board_id, name, color, created_by) VALUES ($1, NULL, $2, $3, $4)',
    [req.orgId, name.trim(), color || '#3AA0E0', req.session.user.id]
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
