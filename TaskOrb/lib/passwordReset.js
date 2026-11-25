const crypto = require('crypto');
const pool = require('../db/pool');

const TTL_MINUTES = 60;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

// Creates a fresh link for a user; any earlier unused links stop working.
async function createResetLink(req, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
    [userId, hash(token), String(TTL_MINUTES)]
  );
  return `${baseUrl(req)}/reset/${token}`;
}

async function findValidReset(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
  const { rows } = await pool.query(
    `SELECT pr.id, pr.user_id, u.email, u.name FROM password_resets pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > NOW()`,
    [hash(token)]
  );
  return rows[0] || null;
}

module.exports = { createResetLink, findValidReset, TTL_MINUTES };
