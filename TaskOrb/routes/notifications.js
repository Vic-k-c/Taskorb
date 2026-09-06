const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Scoped to whichever org is currently active. Uses res.locals.currentOrg
// (already computed by the app-wide middleware in server.js) rather than
// the redirecting requireOrg gate -- this is a background-polling API
// endpoint, so if no org is active yet it should just return an empty
// result, not redirect a fetch() call to an HTML page.
router.get('/api/notifications', requireAuth, async (req, res) => {
  if (!res.locals.currentOrg) return res.json({ notifications: [], unread_count: 0 });
  try {
    const { rows } = await pool.query(
      'SELECT id, message, link, read, created_at FROM notifications WHERE user_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 20',
      [req.session.user.id, res.locals.currentOrg.id]
    );
    const { rows: unread } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND org_id = $2 AND read = FALSE',
      [req.session.user.id, res.locals.currentOrg.id]
    );
    res.json({ notifications: rows, unread_count: unread[0].count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load notifications.' });
  }
});

router.post('/api/notifications/read', requireAuth, async (req, res) => {
  if (!res.locals.currentOrg) return res.json({ ok: true });
  try {
    await pool.query(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1 AND org_id = $2 AND read = FALSE',
      [req.session.user.id, res.locals.currentOrg.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update notifications.' });
  }
});

module.exports = router;
