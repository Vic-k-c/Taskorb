require('dotenv').config();
const pool = require('./pool');
const paystack = require('../lib/paystack');
const { getPlan, PLAN_ORDER } = require('../lib/plans');

// Imports an existing Paystack subscription (created outside our own
// checkout flow -- e.g. from the previous Bubble-based version of
// TaskOrb) so it keeps renewing under this system going forward, instead
// of making that person re-subscribe from scratch.
//
// SAFE BY DEFAULT: without --confirm, this only looks up and PRINTS what
// it would do. Nothing is written to the database until you re-run it
// with --confirm.
//
// Usage:
//   node db/migrate-subscription.js --email=person@example.com --plan=team --cycle=monthly
//   node db/migrate-subscription.js --email=person@example.com --plan=team --cycle=monthly --org-id=14
//   node db/migrate-subscription.js --email=person@example.com --plan=team --cycle=monthly --confirm
//
// Run this against PRODUCTION credentials (DATABASE_URL and
// PAYSTACK_MODE=live in your environment) since the whole point is to
// read your real Paystack account and write to your real database --
// running it against a dev/test setup won't find anything.

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (match) args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const email = args.email;
  const planKey = args.plan;
  const cycle = args.cycle;
  const confirm = !!args.confirm;
  const orgIdArg = args['org-id'] ? Number(args['org-id']) : null;

  if (!email || !planKey || !cycle) {
    console.error('Usage: node db/migrate-subscription.js --email=<email> --plan=<planKey> --cycle=<monthly|annual> [--org-id=<id>] [--confirm]');
    console.error(`Valid --plan values: ${PLAN_ORDER.filter((k) => k !== 'free').join(', ')}`);
    process.exit(1);
  }
  if (!['monthly', 'annual'].includes(cycle)) {
    console.error('--cycle must be "monthly" or "annual".');
    process.exit(1);
  }
  const plan = getPlan(planKey);
  if (plan.key === 'free' || plan.key !== planKey) {
    console.error(`"${planKey}" is not a valid paid plan key.`);
    process.exit(1);
  }

  console.log(`\nLooking up ${email} on Paystack (PAYSTACK_MODE=${process.env.PAYSTACK_MODE || 'test'})...`);
  let customer;
  try {
    customer = await paystack.getCustomer(email);
  } catch (err) {
    console.error(`Paystack lookup failed: ${err.message}`);
    process.exit(1);
  }

  const subscriptions = customer.subscriptions || [];
  if (subscriptions.length === 0) {
    console.error(`No subscriptions found for ${email} on Paystack. Nothing to import.`);
    process.exit(1);
  }

  const active = subscriptions.find((s) => s.status === 'active') || subscriptions[0];
  console.log('\nSubscription(s) found on Paystack:');
  subscriptions.forEach((s) => {
    const marker = s === active ? '  -> ' : '     ';
    console.log(`${marker}${s.subscription_code}  status=${s.status}  plan=${s.plan && s.plan.name}  amount=${s.amount / 100} ${s.plan && s.plan.currency}  next_payment=${s.next_payment_date}`);
  });
  if (active.status !== 'active') {
    console.warn(`\nWarning: the subscription being imported has status "${active.status}", not "active". Double-check this is the right one.`);
  }

  // Find the user + their org. If they belong to more than one
  // organization, --org-id is required to disambiguate which org gets
  // the subscription.
  const { rows: users } = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [email]);
  if (users.length === 0) {
    console.error(`No TaskOrb user found with email ${email}. They need an account here before you can attach a subscription to their org.`);
    process.exit(1);
  }
  const user = users[0];

  const { rows: orgs } = await pool.query(
    `SELECT o.id, o.name, om.role FROM organizations o
     JOIN org_members om ON om.org_id = o.id
     WHERE om.user_id = $1 ORDER BY o.id ASC`,
    [user.id]
  );
  if (orgs.length === 0) {
    console.error(`${email} doesn't belong to any organization in TaskOrb.`);
    process.exit(1);
  }
  let targetOrg;
  if (orgIdArg) {
    targetOrg = orgs.find((o) => o.id === orgIdArg);
    if (!targetOrg) {
      console.error(`${email} is not a member of org ${orgIdArg}. Their orgs: ${orgs.map((o) => `${o.id} (${o.name})`).join(', ')}`);
      process.exit(1);
    }
  } else if (orgs.length === 1) {
    targetOrg = orgs[0];
  } else {
    console.error(`${email} belongs to multiple organizations -- re-run with --org-id to pick one:\n${orgs.map((o) => `  ${o.id}  ${o.name}  (${o.role})`).join('\n')}`);
    process.exit(1);
  }

  console.log(`\nWill apply to org ${targetOrg.id} (${targetOrg.name}):`);
  console.log(`  plan_key                    -> ${plan.key} (${plan.name})`);
  console.log(`  billing_cycle                -> ${cycle}`);
  console.log(`  subscription_status          -> active`);
  console.log(`  paystack_customer_code       -> ${customer.customer_code}`);
  console.log(`  paystack_subscription_code   -> ${active.subscription_code}`);
  console.log(`  paystack_email_token         -> ${active.email_token}`);
  console.log(`  current_period_end           -> ${active.next_payment_date}`);

  if (!confirm) {
    console.log('\nDry run only -- nothing written. Re-run with --confirm to apply this.');
    process.exit(0);
  }

  await pool.query(
    `UPDATE organizations
     SET plan_key = $2, billing_cycle = $3, subscription_status = 'active',
         paystack_customer_code = $4, paystack_subscription_code = $5, paystack_email_token = $6,
         current_period_end = $7, grace_period_ends_at = NULL, trial_ends_at = NULL
     WHERE id = $1`,
    [targetOrg.id, plan.key, cycle, customer.customer_code, active.subscription_code, active.email_token, active.next_payment_date]
  );
  await pool.query(
    `INSERT INTO billing_transactions (org_id, paystack_reference, plan_key, billing_cycle, type, amount_usd, status, raw_event)
     VALUES ($1, $2, $3, $4, 'other', $5, 'success', $6)`,
    [
      targetOrg.id,
      `manual-migration-${active.subscription_code}`,
      plan.key,
      cycle,
      active.amount ? active.amount / 100 : null,
      JSON.stringify({ note: 'Imported from pre-existing Paystack subscription (Bubble app migration)', customer, subscription: active })
    ]
  );

  console.log(`\nDone. Org ${targetOrg.id} (${targetOrg.name}) is now on ${plan.name} (${cycle}), reusing subscription ${active.subscription_code}.`);
  console.log('Future renewal charges for this subscription will arrive via your normal /webhooks/paystack endpoint and update this org automatically.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration script failed:', err);
  process.exit(1);
});
