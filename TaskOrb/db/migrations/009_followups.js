// Follow-up appointments on cards, plus Web Push subscriptions for
// device-level reminders.
//
// follow_up_remind_at is stored (not computed on the fly) so the reminder
// dispatcher can find due reminders with one cheap indexed query.
// follow_up_reminded_at is how a reminder is claimed exactly once, even if
// two dispatchers (the in-process loop and the external cron ping) run at
// the same moment -- see lib/followups.js#sendDueReminders.
async function up(client) {
  await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS follow_up_remind_before INT NOT NULL DEFAULT 60`);
  await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS follow_up_remind_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS follow_up_reminded_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS follow_up_set_by INT REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cards_followup_due
    ON cards (follow_up_remind_at)
    WHERE follow_up_at IS NOT NULL AND follow_up_reminded_at IS NULL
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cards_followup_at ON cards (follow_up_at) WHERE follow_up_at IS NOT NULL`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         SERIAL PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint   TEXT NOT NULL UNIQUE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id)`);
}

module.exports = { up };
