const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { getUserOrgs, uniqueSlug, getOrgRole } = require('../lib/org');

const router = express.Router();

router.get('/orgs', requireAuth, async (req, res) => {
  const orgs = await getUserOrgs(req.session.user.id, req.session.user.is_platform_admin);
  res.render('orgs', { orgs, currentUser: req.session.user, error: null });
});

router.post('/orgs', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    const orgs = await getUserOrgs(req.session.user.id, req.session.user.is_platform_admin);
    return res.render('orgs', { orgs, currentUser: req.session.user, error: 'Give the organization a name.' });
  }
  try {
    const slug = await uniqueSlug(name);
    const { rows: orgRows } = await pool.query('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [name.trim(), slug]);
    const orgId = orgRows[0].id;
    await pool.query("INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'admin')", [orgId, req.session.user.id]);
    req.session.orgId = orgId;
    res.redirect('/');
  } catch (err) {
    console.error(err);
    const orgs = await getUserOrgs(req.session.user.id, req.session.user.is_platform_admin);
    res.render('orgs', { orgs, currentUser: req.session.user, error: 'Could not create that organization.' });
  }
});

router.post('/orgs/switch/:id', requireAuth, async (req, res) => {
  // Platform admins can enter any org for support purposes without needing
  // a membership row in each one.
  if (!req.session.user.is_platform_admin) {
    const { rows } = await pool.query(
      'SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
    if (!rows[0]) return res.status(403).json({ error: "You're not a member of that organization." });
  }
  req.session.orgId = Number(req.params.id);
  res.json({ ok: true });
});

router.patch('/orgs/:id', requireAuth, async (req, res) => {
  const orgId = Number(req.params.id);
  const role = await getOrgRole(req.session.user.id, orgId, req.session.user.is_platform_admin);
  if (role !== 'admin') return res.status(403).json({ error: 'Only an admin of this organization can rename it.' });

  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Give the organization a name.' });
  try {
    await pool.query('UPDATE organizations SET name = $1 WHERE id = $2', [name.trim(), orgId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not rename that organization.' });
  }
});

router.delete('/orgs/:id', requireAuth, async (req, res) => {
  const orgId = Number(req.params.id);
  const role = await getOrgRole(req.session.user.id, orgId, req.session.user.is_platform_admin);
  if (role !== 'admin') return res.status(403).json({ error: 'Only an admin of this organization can delete it.' });
  if (req.body.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Cards don't cascade automatically (their FK is ON DELETE SET NULL, so
    // orphans don't quietly disappear) -- clean them up explicitly first,
    // same pattern used for single-board deletion.
    await client.query(
      'DELETE FROM cards WHERE list_id IN (SELECT id FROM lists WHERE board_id IN (SELECT id FROM boards WHERE org_id = $1))',
      [orgId]
    );
    await client.query('DELETE FROM organizations WHERE id = $1', [orgId]); // cascades boards, lists, board_members, org_members, notifications
    await client.query('COMMIT');
    if (req.session.orgId === orgId) req.session.orgId = null;
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not delete that organization.' });
  } finally {
    client.release();
  }
});

module.exports = router;
