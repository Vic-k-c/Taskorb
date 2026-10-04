// Lets a notification be flagged as "celebration"-worthy (e.g. a
// subscription being activated) so the client shows a one-time popup
// modal, not just a bell-icon badge. Existing rows default to 'info',
// which only ever shows in the dropdown as before -- this is purely
// additive, nothing about current notification behavior changes.
async function up(client) {
  await client.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'info'`);
}

module.exports = { up };
