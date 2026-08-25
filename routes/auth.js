const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, currentUser: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.render('login', { error: 'Incorrect email or password.', currentUser: null });
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Something went wrong. Try again.', currentUser: null });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Registration: open ONLY when no users exist yet (bootstrap the first admin).
// After that, new members are created from /users by an admin.
router.get('/register', async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (rows[0].count > 0) return res.redirect('/login');
  res.render('register', { error: null, currentUser: null });
});

router.post('/register', async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (rows[0].count > 0) return res.redirect('/login');

  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) {
    return res.render('register', { error: 'Fill out every field. Password needs 6+ characters.', currentUser: null });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows: inserted } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name.trim(), email.toLowerCase().trim(), hash, 'admin']
    );
    req.session.user = inserted[0];
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('register', { error: 'Could not create that account (email may already be in use).', currentUser: null });
  }
});

module.exports = router;
