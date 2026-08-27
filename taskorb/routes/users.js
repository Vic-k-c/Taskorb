const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg, requireOrgRole } = require('../lib/org');
const { notify } = require('../lib/notify');

const router = express.Router();

async function loadOrgMembers(orgId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, om.role, om.created_at
     FROM org_members om JOIN users u ON u.id = om.user_id
     WHERE om.org_id = $1 ORDER BY om.created_at ASC`,
    [orgId]
  );
  return rows;
}

router.get('/users', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const users = await loadOrgMembers(req.orgId);
  res.render('users', { users, error: null, currentUser: req.session.user });
});

// Adding a member here only works for people who already have a TaskOrb
// account (self-serve signup is the only way to create one). This keeps
// account creation/passwords entirely with the account owner -- an org
// admin can grant org access, but never set someone else's password.
router.post('/users', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const { email, role } = req.body;
  const users = await loadOrgMembers(req.orgId);

  if (!email || !email.trim()) {
    return res.render('users', { users, error: 'Enter an email address.', currentUser: req.session.user });
  }
  if (!['admin', 'leader', 'member'].includes(role)) {
    return res.render('users', { users, error: 'Invalid role.', currentUser: req.session.user });
  }

  try {
    const { rows: found } = await pool.query('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!found[0]) {
      return res.render('users', {
        users, currentUser: req.session.user,
        error: `No TaskOrb account exists for ${email}. Ask them to sign up at /register first (they can join this org afterward), then add them here.`
      });
    }

    await pool.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = $3`,
      [req.orgId, found[0].id, role]
    );
    const { rows: orgRows } = await pool.query('SELECT name FROM organizations WHERE id = $1', [req.orgId]);
    await notify(found[0].id, req.orgId, `${req.session.user.name} added you to "${orgRows[0].name}" as ${role}.`, '/boards');

    res.redirect('/users');
  } catch (err) {
    console.error(err);
    res.render('users', { users, error: 'Could not add that member. Try again.', currentUser: req.session.user });
  }
});

router.delete('/users/:id', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const targetId = Number(req.params.id);

  const { rows: admins } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM org_members WHERE org_id = $1 AND role = 'admin'",
    [req.orgId]
  );
  const { rows: target } = await pool.query(
    'SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2',
    [req.orgId, targetId]
  );
  if (target[0] && target[0].role === 'admin' && admins[0].count <= 1) {
    const users = await loadOrgMembers(req.orgId);
    return res.render('users', { users, currentUser: req.session.user, error: 'This organization needs at least one admin -- promote someone else first.' });
  }

  // Removes them from this org only -- their account, and any other org
  // they belong to, is untouched.
  await pool.query('DELETE FROM org_members WHERE org_id = $1 AND user_id = $2', [req.orgId, targetId]);
  await pool.query('DELETE FROM board_members WHERE user_id = $1 AND board_id IN (SELECT id FROM boards WHERE org_id = $2)', [targetId, req.orgId]);
  res.redirect('/users');
});

module.exports = router;
