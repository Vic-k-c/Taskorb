const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../lib/org');

const router = express.Router();

router.get('/platform', requireAuth, requirePlatformAdmin, async (req, res) => {
  const { rows: orgs } = await pool.query(`
    SELECT o.id, o.name, o.slug, o.created_at,
           (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id) AS member_count,
           (SELECT COUNT(*) FROM boards b WHERE b.org_id = o.id) AS board_count
    FROM organizations o
    ORDER BY o.created_at DESC
  `);
  const { rows: totals } = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM organizations) AS org_count,
           (SELECT COUNT(*)::int FROM users) AS user_count,
           (SELECT COUNT(*)::int FROM boards) AS board_count,
           (SELECT COUNT(*)::int FROM cards) AS card_count
  `);
  res.render('platform', { orgs, totals: totals[0], currentUser: req.session.user });
});

module.exports = router;
