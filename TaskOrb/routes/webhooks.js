const express = require('express');
const pool = require('../db/pool');
const { verifyWebhookSignature } = require('../lib/paystack');
const { getPlan, notifyOrgAdmins, applyChargeSuccess } = require('../lib/plans');

const router = express.Router();

// One month or one year of grace before a subscription that's been
// canceled loses access, and how long a grace window lasts after a
// renewal payment fails -- both configurable without a code change since
// "how long is fair" is a business call, not a technical one.
const GRACE_PERIOD_DAYS = Number(process.env.BILLING_GRACE_PERIOD_DAYS || 7);

// A successful charge -- either the very first payment on a new
// subscription, or an automatic renewal. See lib/plans.js#applyChargeSuccess
// for the actual DB update -- this is also called directly from
// routes/billing.js's checkout callback as a same-request fallback, so a
// working upgrade doesn't depend entirely on this webhook arriving.
async function handleChargeSuccess(data) {
  const orgId = data.metadata && data.metadata.orgId ? Number(data.metadata.orgId) : null;
  const planKey = data.metadata && data.metadata.planKey;
  const cycle = data.metadata && data.metadata.cycle;
  const customerCode = data.customer && data.customer.customer_code;
  const amountUsd = data.amount ? data.amount / 100 : null;

  await applyChargeSuccess({ orgId, customerCode, planKey, cycle, reference: data.reference, amountUsd, rawEvent: data });
}

// Fired once Paystack finishes setting up the recurring subscription
// itself (shortly after the first charge.success). This is where we learn
// the subscription_code and email_token we need later to cancel it.
async function handleSubscriptionCreate(data) {
  const customerCode = data.customer && data.customer.customer_code;
  if (!customerCode) return;
  const nextPaymentDate = data.next_payment_date ? new Date(data.next_payment_date) : null;
  await pool.query(
    `UPDATE organizations
     SET paystack_subscription_code = $2, paystack_email_token = $3,
         current_period_end = COALESCE($4, current_period_end)
     WHERE paystack_customer_code = $1`,
    [customerCode, data.subscription_code, data.email_token, nextPaymentDate]
  );
}

// Fired when a subscription stops -- either the admin canceled it (see
// POST /billing/cancel in routes/billing.js) or Paystack gave up after
// repeated failed renewal attempts. Either way, access continues until
// current_period_end (already set), then the lazy check in
// lib/plans.js#syncOrgPlan downgrades to Free on the next page load.
async function handleSubscriptionDisable(data) {
  const customerCode = data.customer && data.customer.customer_code;
  if (!customerCode) return;
  await pool.query(
    `UPDATE organizations SET subscription_status = 'canceled' WHERE paystack_customer_code = $1`,
    [customerCode]
  );
  const { rows } = await pool.query('SELECT id, plan_key, current_period_end FROM organizations WHERE paystack_customer_code = $1', [customerCode]);
  if (rows[0]) {
    const until = rows[0].current_period_end ? new Date(rows[0].current_period_end).toLocaleDateString() : 'the end of the current billing period';
    await notifyOrgAdmins(
      rows[0].id,
      `Your subscription has been canceled. You'll keep ${getPlan(rows[0].plan_key).name} access until ${until}, then this organization moves to the Free plan.`,
      '/billing'
    );
  }
}

// A renewal charge failed (expired card, insufficient funds, etc.). Starts
// the grace period rather than downgrading immediately -- gives the admin
// a real chance to update their card before anything gets locked.
async function handleInvoicePaymentFailed(data) {
  const customerCode = data.customer && data.customer.customer_code;
  if (!customerCode) return;
  const graceEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `UPDATE organizations SET subscription_status = 'grace', grace_period_ends_at = $2 WHERE paystack_customer_code = $1`,
    [customerCode, graceEndsAt]
  );
  const { rows } = await pool.query('SELECT id, plan_key FROM organizations WHERE paystack_customer_code = $1', [customerCode]);
  if (rows[0]) {
    await notifyOrgAdmins(
      rows[0].id,
      `Your last payment didn't go through. Update your billing details within ${GRACE_PERIOD_DAYS} days (by ${graceEndsAt.toLocaleDateString()}) or this organization will drop to the Free plan.`,
      '/billing'
    );
  }
}

router.post('/webhooks/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  // req.body is a raw Buffer here (see express.raw() above), not parsed
  // JSON -- required so the signature is checked against the exact bytes
  // Paystack sent.
  const signature = req.get('x-paystack-signature');
  if (!verifyWebhookSignature(req.body, signature)) {
    console.error('Paystack webhook: signature verification failed.');
    return res.status(401).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.status(400).send('Invalid JSON');
  }

  // Acknowledge receipt immediately, then process -- Paystack retries on
  // non-2xx or timeout, and our processing (a few DB queries) is safe to
  // run after responding since nothing here depends on the HTTP response.
  res.status(200).send('ok');

  try {
    switch (event.event) {
      case 'charge.success':
        await handleChargeSuccess(event.data);
        break;
      case 'subscription.create':
        await handleSubscriptionCreate(event.data);
        break;
      case 'subscription.disable':
      case 'subscription.not_renew':
        await handleSubscriptionDisable(event.data);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data);
        break;
      default:
        // Logged but not acted on -- e.g. invoice.create, invoice.update.
        console.log(`Paystack webhook: unhandled event type "${event.event}"`);
    }
  } catch (err) {
    console.error(`Paystack webhook: error handling "${event.event}":`, err.message);
  }
});

module.exports = router;
