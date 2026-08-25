const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows: users } = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC');
  res.render('users', { users, error: null, currentUser: req.session.user });
});

router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body;
  const { rows: users } = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC');

  if (!name || !email || !password || password.length < 6) {
    return res.render('users', { users, error: 'Fill out every field. Password needs 6+ characters.', currentUser: req.session.user });
  }
  if (!['admin', 'leader', 'member'].includes(role)) {
    return res.render('users', { users, error: 'Invalid role.', currentUser: req.session.user });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [name.trim(), email.toLowerCase().trim(), hash, role]
    );
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    res.render('users', { users, error: 'Could not create that account (email may already be in use).', currentUser: req.session.user });
  }
});

router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.redirect('/users');
  }
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.redirect('/users');
});

module.exports = router;
