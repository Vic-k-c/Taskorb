const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { TEMPLATES } = require('../lib/templates');

const router = express.Router();

router.get('/account', requireAuth, async (req, res) => {
  res.render('account', { templates: TEMPLATES, currentUser: req.session.user, error: null, success: null });
});

router.post('/account', requireAuth, async (req, res) => {
  const { name, email, current_password, new_password, default_template } = req.body;
  const render = (error, success) => res.render('account', { templates: TEMPLATES, currentUser: req.session.user, error, success });

  if (!name || !name.trim() || !email || !email.trim()) {
    return render('Name and email are required.', null);
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
    const user = rows[0];

    let newHash = user.password_hash;
    if (new_password) {
      if (!current_password || !(await bcrypt.compare(current_password, user.password_hash))) {
        return render('Current password is incorrect.', null);
      }
      if (new_password.length < 6) {
        return render('New password needs to be at least 6 characters.', null);
      }
      newHash = await bcrypt.hash(new_password, 10);
    }

    const template = TEMPLATES[default_template] ? default_template : 'blank';

    const { rows: updated } = await pool.query(
      `UPDATE users SET name = $1, email = $2, password_hash = $3, default_template = $4
       WHERE id = $5 RETURNING id, name, email, role, default_template`,
      [name.trim(), email.toLowerCase().trim(), newHash, template, req.session.user.id]
    );

    // Keep the session in sync so the nav/UI reflect changes immediately.
    req.session.user = updated[0];
    render(null, 'Saved.');
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return render('That email is already in use.', null);
    render('Could not save changes. Try again.', null);
  }
});

module.exports = router;
