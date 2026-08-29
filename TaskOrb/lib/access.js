const pool = require('../db/pool');

const RANK = { viewer: 1, editor: 2, owner: 3 };

function atLeast(have, need) {
  return (RANK[have] || 0) >= (RANK[need] || 0);
}

async function getBoardOrgId(boardId) {
  const { rows } = await pool.query('SELECT org_id FROM boards WHERE id = $1', [boardId]);
  return rows[0] ? rows[0].org_id : null;
}

// Board permission is org-scoped: a board only "exists" for someone if it
// belongs to the org they're currently active in. This blocks cross-org
// access even if a stale board_members row somehow existed (defense in
// depth on top of every board query already filtering by org_id).
async function getBoardPermission(userId, boardId, currentOrgId, orgRole) {
  const boardOrgId = await getBoardOrgId(boardId);
  if (!boardOrgId || boardOrgId !== currentOrgId) return null;
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

// Express middleware factory for routes shaped /boards/:id/... Requires
// req.orgId / req.orgRole to already be set (i.e. requireOrg ran first).
function requireBoardAccess(minPermission) {
  return async (req, res, next) => {
    const boardId = req.params.id || req.params.boardId;
    try {
      const permission = await getBoardPermission(req.session.user.id, boardId, req.orgId, req.orgRole);
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

module.exports = { atLeast, getBoardOrgId, getBoardPermission, getBoardIdForList, getBoardIdForCard, requireBoardAccess };
