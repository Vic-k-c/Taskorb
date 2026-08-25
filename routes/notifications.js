const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, message, link, read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.session.user.id]
    );
    const { rows: unread } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = FALSE',
      [req.session.user.id]
    );
    res.json({ notifications: rows, unread_count: unread[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load notifications.' });
  }
});

router.post('/api/notifications/read', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE', [req.session.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update notifications.' });
  }
});

module.exports = router;
