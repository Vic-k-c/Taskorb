const pool = require('../db/pool');

const RANK = { viewer: 1, editor: 2, owner: 3 };

function atLeast(have, need) {
  return (RANK[have] || 0) >= (RANK[need] || 0);
}

// Org admins can see/manage every board (oversight), regardless of membership.
async function getBoardPermission(userId, boardId, orgRole) {
  if (orgRole === 'admin') return 'owner';
  const { rows } = await pool.query(
    'SELECT permission FROM board_members WHERE board_id = $1 AND user_id = $2',
    [boardId, userId]
  );
  return rows[0] ? rows[0].permission : null;
}

async function getBoardIdForList(listId) {
  const { rows } = await pool.query('SELECT board_id FROM lists WHERE id = $1', [listId]);
  return rows[0] ? rows[0].board_id : null;
}

async function getBoardIdForCard(cardId) {
  const { rows } = await pool.query(
    `SELECT l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = $1`,
    [cardId]
  );
  return rows[0] ? rows[0].board_id : null;
}

// Express middleware factory for routes shaped /boards/:id/...
function requireBoardAccess(minPermission) {
  return async (req, res, next) => {
    const boardId = req.params.id || req.params.boardId;
    try {
      const permission = await getBoardPermission(req.session.user.id, boardId, req.session.user.role);
      if (!permission || !atLeast(permission, minPermission)) {
        return res.status(403).json({ error: 'You do not have permission to do that on this board.' });
      }
      req.boardPermission = permission;
      req.boardId = Number(boardId);
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not verify board access.' });
    }
  };
}

module.exports = { atLeast, getBoardPermission, getBoardIdForList, getBoardIdForCard, requireBoardAccess };
