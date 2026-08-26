const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const uid = req.session.user.id;

  // Base filter: every card that lives on a board this user can see.
  const boardFilter = isAdmin
    ? ''
    : `JOIN board_members bm ON bm.board_id = l.board_id AND bm.user_id = $1`;
  const params = isAdmin ? [] : [uid];

  const { rows: totals } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM cards c JOIN lists l ON l.id = c.list_id ${boardFilter}`,
    params
  );
  const { rows: thisWeek } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM cards c JOIN lists l ON l.id = c.list_id ${boardFilter}
     WHERE c.created_at >= NOW() - INTERVAL '7 days'`,
    params
  );
  const { rows: assignedToMe } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM cards c WHERE c.assigned_to = $1`,
    [uid]
  );
  const { rows: boardCount } = await pool.query(
    isAdmin
      ? `SELECT COUNT(*)::int AS count FROM boards`
      : `SELECT COUNT(*)::int AS count FROM board_members WHERE user_id = $1`,
    isAdmin ? [] : [uid]
  );

  const { rows: byBoard } = await pool.query(
    `SELECT b.title AS name, COUNT(c.id)::int AS count
     FROM boards b
     LEFT JOIN lists l ON l.board_id = b.id
     LEFT JOIN cards c ON c.list_id = l.id
     ${isAdmin ? '' : 'JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1'}
     GROUP BY b.id, b.title
     ORDER BY count DESC
     LIMIT 8`,
    isAdmin ? [] : [uid]
  );

  const { rows: byPriority } = await pool.query(
    `SELECT c.priority, COUNT(*)::int AS count FROM cards c JOIN lists l ON l.id = c.list_id ${boardFilter}
     GROUP BY c.priority`,
    params
  );

  const { rows: leaderboard } = await pool.query(
    `SELECT u.name, COUNT(c.id)::int AS count
     FROM users u JOIN cards c ON c.created_by = u.id
     JOIN lists l ON l.id = c.list_id ${boardFilter}
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
