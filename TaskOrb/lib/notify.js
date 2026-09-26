const pool = require('../db/pool');

// Fire-and-forget style: callers await it, but a failure here should never
// block the primary action (assigning a card shouldn't fail because a
// notification insert failed). type 'celebration' also triggers a
// one-time popup modal client-side, not just a bell-icon entry -- see
// public/js/notifications.js.
async function notify(userId, orgId, message, link, type) {
  if (!userId) return;
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, org_id, message, link, type) VALUES ($1, $2, $3, $4, $5)',
      [userId, orgId || null, message, link || null, type || 'info']
    );
  } catch (err) {
    console.error('notify() failed:', err.message);
  }
}

module.exports = { notify };
