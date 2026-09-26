// Adds subscription/billing state to organizations, plus a transaction log
// for Paystack events. Plan LIMITS, FEATURES, and PRICES intentionally do
// NOT live in the database -- they live in lib/plans.js as a single
// source of truth alongside the Paystack plan codes (which come from env
// vars). This `plans` table exists only so organizations.plan_key has
// something to reference with referential integrity, and so reporting
// queries can JOIN to a human-readable name.
async function up(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS plans (
      key  TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  await client.query(`
    INSERT INTO plans (key, name) VALUES
      ('free', 'Free'),
      ('individual', 'Individual'),
      ('team_starter', 'Team Starter'),
      ('team', 'Team'),
      ('team_growth', 'Team Growth'),
      ('team_business', 'Team Business')
    ON CONFLICT (key) DO NOTHING
  `);

  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_key TEXT NOT NULL DEFAULT 'free' REFERENCES plans(key)`);
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_cycle TEXT CHECK (billing_cycle IN ('monthly','annual'))`);
  // none = never subscribed; active = paid and current; grace = payment
  // failed but within the grace window (still full access); canceled =
  // admin canceled, access continues until current_period_end then this
  // row lazily flips to plan_key='free' (see lib/plans.js#syncOrgPlan).
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none' CHECK (subscription_status IN ('none','active','grace','canceled'))`);
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS paystack_customer_code TEXT`);
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS paystack_subscription_code TEXT`);
  // Paystack's subscription-management endpoints (disable/enable) require
  // the customer's per-subscription "email token" from the webhook payload
  // -- it's not the same as the subscription code.
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS paystack_email_token TEXT`);
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP`);
  await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMP`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS billing_transactions (
      id                 SERIAL PRIMARY KEY,
      org_id             INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      paystack_reference TEXT UNIQUE,
      plan_key           TEXT,
      billing_cycle      TEXT,
      type               TEXT NOT NULL CHECK (type IN ('subscription_start','renewal','upgrade','downgrade','cancel','other')),
      amount_usd         NUMERIC(10,2),
      status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
      raw_event          JSONB,
      created_at         TIMESTAMP DEFAULT NOW()
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS idx_billing_tx_org ON billing_transactions(org_id)');
  // Paystack retries webhook delivery; this makes handling an event twice
  // a no-op instead of double-processing a payment.
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_tx_reference ON billing_transactions(paystack_reference) WHERE paystack_reference IS NOT NULL');
}

module.exports = { up };
