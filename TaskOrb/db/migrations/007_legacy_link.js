// Lets an org stop being re-prompted after explicitly declining to link a
// legacy (pre-migration) Paystack subscription -- see
// lib/plans.js#findLegacySubscription and the per-login check in
// server.js.
async function up(client) {
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legacy_link_declined_at TIMESTAMP`);
}

module.exports = { up };
