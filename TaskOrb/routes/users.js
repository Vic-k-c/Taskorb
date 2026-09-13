const express = require('express');
const bcrypt = require('bcryptjs');
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

// Two ways to add someone: invite an EXISTING account (self-serve accounts
// are the default model, so this covers the common case without an admin
// ever touching a password), or have the admin create a brand new account
// directly and set its initial password -- useful for people who won't be
// signing themselves up (e.g. a volunteer coordinator adding field workers
// in bulk). Either way they end up as a member of the current org.
router.post('/users', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const { mode, email, role, name, password } = req.body;
  const users = await loadOrgMembers(req.orgId);
  const render = (error) => res.render('users', { users, currentUser: req.session.user, error });

  if (!['admin', 'leader', 'member'].includes(role)) return render('Invalid role.');

  if (mode === 'create') {
    if (!name || !name.trim() || !email || !email.trim() || !password) return render('Fill out every field.');
    if (password.length < 6) return render('Password needs to be at least 6 characters.');

    const normalizedEmail = email.toLowerCase().trim();
    try {
      const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
      if (existing[0]) {
        return render(`${email} already has a TaskOrb account -- use "Invite existing account" instead.`);
      }
      const hash = await bcrypt.hash(password, 10);
      const { rows: created } = await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name.trim(), normalizedEmail, hash]
      );
      await pool.query('INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)', [req.orgId, created[0].id, role]);
      res.redirect('/users');
    } catch (err) {
      console.error(err);
      render('Could not create that account. Try again.');
    }
    return;
  }

  // mode === 'invite' (default): only works for people who already have a
  // TaskOrb account.
  if (!email || !email.trim()) return render('Enter an email address.');

  try {
    const { rows: found } = await pool.query('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!found[0]) {
      return render(`No TaskOrb account exists for ${email}. Either have them sign up at /register first, or use "Create new account" instead.`);
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
    render('Could not add that member. Try again.');
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
