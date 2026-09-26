// Adds trial support. subscription_status gets a new allowed value
// ('trial'), which needs the existing CHECK constraint replaced --
// Postgres names a single-column inline CHECK constraint
// "<table>_<column>_check" by default when it isn't given an explicit
// name, which is exactly how it was created in 005_billing.js, so this
// can drop it by that predictable name rather than needing to look it up.
async function up(client) {
  await client.query(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_subscription_status_check`);
  await client.query(`ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_status_check CHECK (subscription_status IN ('none','trial','active','grace','canceled'))`);

  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP`);
  // Prevents starting a second trial (on the same plan or a different
  // one) once the first has been used -- without this, an org could
  // cycle through every paid tier's trial back to back for permanent
  // free access.
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS has_used_trial BOOLEAN NOT NULL DEFAULT FALSE`);
  // Set once the single pre-expiry reminder notification has gone out,
  // so the lazy per-request check (lib/plans.js#syncOrgPlan) doesn't
  // re-send it on every page load during the reminder window.
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_reminder_sent_at TIMESTAMP`);
}

module.exports = { up };
