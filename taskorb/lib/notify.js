const pool = require('../db/pool');

// Fire-and-forget style: callers await it, but a failure here should never
// block the primary action (assigning a card shouldn't fail because a
// notification insert failed).
async function notify(userId, message, link) {
  if (!userId) return;
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, message, link) VALUES ($1, $2, $3)',
      [userId, message, link || null]
    );
  } catch (err) {
    console.error('notify() failed:', err.message);
  }
}

module.exports = { notify };
