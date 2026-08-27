const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg } = require('../lib/org');

const router = express.Router();

router.get('/', requireAuth, requireOrg, async (req, res) => {
  const isOrgAdmin = req.orgRole === 'admin';
  const uid = req.session.user.id;
  const orgId = req.orgId;

  // Base filter: every card that lives on a board in the active org that
  // this user can see.
  const boardFilter = isOrgAdmin
    ? 'WHERE b.org_id = $1'
    : `JOIN board_members bm ON bm.board_id = l.board_id AND bm.user_id = $2 WHERE b.org_id = $1`;
  const params = isOrgAdmin ? [orgId] : [orgId, uid];

  const baseJoin = `FROM cards c JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id`;

  const { rows: totals } = await pool.query(`SELECT COUNT(*)::int AS total ${baseJoin} ${boardFilter}`, params);
  const { rows: thisWeek } = await pool.query(
    `SELECT COUNT(*)::int AS count ${baseJoin} ${boardFilter} AND c.created_at >= NOW() - INTERVAL '7 days'`,
    params
  );
  const { rows: assignedToMe } = await pool.query(
    `SELECT COUNT(*)::int AS count ${baseJoin} WHERE b.org_id = $1 AND c.assigned_to = $2`,
    [orgId, uid]
  );
  const { rows: boardCount } = await pool.query(
    isOrgAdmin
      ? `SELECT COUNT(*)::int AS count FROM boards WHERE org_id = $1`
      : `SELECT COUNT(*)::int AS count FROM boards b JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $2 WHERE b.org_id = $1`,
    isOrgAdmin ? [orgId] : [orgId, uid]
  );

  const { rows: byBoard } = await pool.query(
    `SELECT b.title AS name, COUNT(c.id)::int AS count
     FROM boards b
     LEFT JOIN lists l ON l.board_id = b.id
     LEFT JOIN cards c ON c.list_id = l.id
     ${isOrgAdmin ? '' : 'JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $2'}
     WHERE b.org_id = $1
     GROUP BY b.id, b.title
     ORDER BY count DESC
     LIMIT 8`,
    isOrgAdmin ? [orgId] : [orgId, uid]
  );

  const { rows: byPriority } = await pool.query(
    `SELECT c.priority, COUNT(*)::int AS count ${baseJoin} ${boardFilter}
     GROUP BY c.priority`,
    params
  );

  const { rows: leaderboard } = await pool.query(
    `SELECT u.name, COUNT(c.id)::int AS count
     FROM users u JOIN cards c ON c.created_by = u.id
     JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id ${boardFilter}
     GROUP BY u.id, u.name
     ORDER BY count DESC
     LIMIT 10`,
    params
  );

  res.render('dashboard', {
    currentUser: req.session.user,
    total: totals[0].total,
    thisWeek: thisWeek[0].count,
    assignedToMe: assignedToMe[0].count,
    boardCount: boardCount[0].count,
    byBoard,
    byPriority,
    leaderboard
  });
});

module.exports = router;
