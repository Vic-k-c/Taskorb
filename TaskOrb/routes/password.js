const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { sendMail, mailEnabled } = require('../lib/mail');
const { createResetLink, findValidReset, TTL_MINUTES } = require('../lib/passwordReset');

const router = express.Router();

router.get('/forgot', (req, res) => {
  if (req.session.user) return res.redirect('/account');
  res.render('forgot', { sent: false, error: null, currentUser: null });
});

// Always answers the same way whether or not the email exists, so this page
// can't be used to find out who has an account.
router.post('/forgot', async (req, res) => {
  const email = ((req.body && req.body.email) || '').toLowerCase().trim();
  const done = () => res.render('forgot', { sent: true, error: null, currentUser: null });
  if (!email) return res.render('forgot', { sent: false, error: 'Enter your email address.', currentUser: null });
  try {
    const { rows } = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (user) {
      const link = await createResetLink(req, user.id);
      if (mailEnabled()) {
        const r = await sendMail({
          to: user.email,
          subject: 'Reset your TaskOrb password',
          text: `Hi ${user.name},\n\nUse this link to choose a new TaskOrb password (valid for ${TTL_MINUTES} minutes):\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
          html: `<p>Hi ${String(user.name).replace(/[<>&]/g, '')},</p><p><a href="${link}">Choose a new TaskOrb password</a> (link valid for ${TTL_MINUTES} minutes).</p><p>If you didn't ask for this, you can ignore this email.</p>`
        });
        if (!r.sent) console.error('Password reset email failed:', r.reason);
      } else {
        console.warn(`Password reset requested for ${user.email} but email is not configured. Platform admin can generate a link at /platform.`);
      }
    }
    done();
  } catch (err) {
    console.error(err);
    res.render('forgot', { sent: false, error: 'Something went wrong. Try again.', currentUser: null });
  }
});

router.get('/reset/:token', async (req, res) => {
  const reset = await findValidReset(req.params.token);
  res.render('reset', { valid: !!reset, token: req.params.token, error: null, currentUser: null });
});

router.post('/reset/:token', async (req, res) => {
  const { password, confirm } = req.body || {};
  const token = req.params.token;
  const again = (error) => res.render('reset', { valid: true, token, error, currentUser: null });
  try {
    const reset = await findValidReset(token);
    if (!reset) return res.render('reset', { valid: false, token, error: null, currentUser: null });
    if (!password || password.length < 6) return again('Password needs to be at least 6 characters.');
    if (password !== confirm) return again('The two passwords don\'t match.');

    const newHash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, reset.user_id]);
    await pool.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [reset.user_id]);
    // Log out every existing session for this account (a reset usually means
    // the old password may be compromised, or forgotten on a shared device).
    await pool.query(`DELETE FROM session WHERE sess->'user'->>'id' = $1`, [String(reset.user_id)]).catch(() => {});
    res.render('reset-done', { currentUser: null });
  } catch (err) {
    console.error(err);
    again('Something went wrong. Try again.');
  }
});

module.exports = router;
