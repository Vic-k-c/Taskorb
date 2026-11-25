// Each board can name its dates whatever fits how that board is used --
// "Due date" for a task board, "Follow-up" for outreach, "Visit",
// "Appointment", "Deadline", ... The underlying feature (a date on a card
// that shows on the calendar and sends reminders) is the same everywhere;
// only the wording changes. "Due date" is the neutral default.
async function up(client) {
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS date_label TEXT NOT NULL DEFAULT 'Due date'`);
}

module.exports = { up };
