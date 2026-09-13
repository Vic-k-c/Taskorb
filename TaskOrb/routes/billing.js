const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg, requireOrgRole, getOrgById } = require('../lib/org');
const { planList, getPlan, getOrgUsage, applyChargeSuccess } = require('../lib/plans');
const paystack = require('../lib/paystack');

const router = express.Router();

// Human-readable reasons a paywall redirect can carry, shown as a banner
// on the upgrade page so it's clear WHY someone landed there instead of
// just seeing a generic pricing page.
const REASON_LABELS = {
  boardLimit: "You've reached your plan's board limit.",
  seatLimit: "You've reached your plan's seat limit.",
  hasMap: 'The map feature needs a paid plan.',
  hasExport: 'Exporting needs a paid plan.',
  hasOrgTags: 'Org-wide tags need a paid plan.',
  hasMultiAdmin: 'Multiple org admins need a Team Growth plan or higher.',
  attachmentLimit: "You've reached your plan's attachment storage limit."
};

// --- Billing dashboard: current plan, usage, history. Admin-only since
// this is where money moves. ---
router.get('/billing', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const org = await getOrgById(req.orgId);
  const plan = getPlan(org.plan_key);
  const usage = await getOrgUsage(req.orgId);
  const { rows: transactions } = await pool.query(
    'SELECT * FROM billing_transactions WHERE org_id = $1 ORDER BY created_at DESC LIMIT 20',
    [req.orgId]
  );
  res.render('billing', { org, plan, usage, transactions, checkoutStatus: req.query.checkout || null, currentUser: req.session.user });
});

// --- Pricing / upgrade page. Any org member can view it (so a non-admin
// who hits a paywall understands why), but only an admin can actually
// check out -- see requireOrgRole('admin') on /billing/checkout below. ---
router.get('/billing/upgrade', requireAuth, requireOrg, async (req, res) => {
  const org = await getOrgById(req.orgId);
  const reasonKey = req.query.reason;
  const reasonMessage = REASON_LABELS[reasonKey] || null;
  res.render('pricing', {
    plans: planList(),
    currentPlanKey: org.plan_key,
    reasonMessage,
    isAdmin: req.orgRole === 'admin',
    currentUser: req.session.user
  });
});

// --- Start a checkout. Admin-only. Redirects the browser to Paystack's
// hosted checkout page. ---
router.post('/billing/checkout', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const { planKey, cycle } = req.body;
  const plan = getPlan(planKey);
  if (plan.key === 'free' || !['monthly', 'annual'].includes(cycle)) {
    return res.redirect('/billing/upgrade');
  }
  const planCode = plan.paystackPlanCode[cycle];
  if (!planCode) {
    console.error(`No Paystack plan code configured for ${plan.key}/${cycle}. Check env vars.`);
    return res.status(500).render('error', {
      title: 'Billing is not fully configured',
      message: 'This plan is not set up yet. Please contact support.',
      currentUser: req.session.user
    });
  }
  const amount = cycle === 'monthly' ? plan.priceMonthly : plan.priceAnnual;

  try {
    const protocolHost = `${req.protocol}://${req.get('host')}`;
    const { authorization_url: authorizationUrl } = await paystack.initializeTransaction({
      email: req.session.user.email,
      amountUsd: amount,
      planCode,
      callbackUrl: `${protocolHost}/billing/callback`,
      metadata: { orgId: req.orgId, planKey: plan.key, cycle }
    });
    res.redirect(authorizationUrl);
  } catch (err) {
    console.error('Paystack checkout initialization failed:', err.message);
    res.status(502).render('error', {
      title: 'Could not start checkout',
      message: "Paystack didn't accept this request. Please try again in a moment.",
      currentUser: req.session.user
    });
  }
});

// --- Paystack redirects here after checkout. This used to be read-only
// (just verify + show a message), relying entirely on the webhook
// (routes/webhooks.js) to actually activate the plan. That's still the
// authoritative path, but a person landing back here after a real,
// successful payment shouldn't have to wait on webhook delivery to see
// it take effect -- so this now applies the same update directly too
// (applyChargeSuccess is idempotent, so no harm if the webhook already
// did it, or does it moments later). ---
router.get('/billing/callback', requireAuth, requireOrg, async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.redirect('/billing');
  try {
    const tx = await paystack.verifyTransaction(reference);
    if (tx.status === 'success') {
      const orgId = tx.metadata && tx.metadata.orgId ? Number(tx.metadata.orgId) : req.orgId;
      const planKey = tx.metadata && tx.metadata.planKey;
      const cycle = tx.metadata && tx.metadata.cycle;
      const customerCode = tx.customer && tx.customer.customer_code;
      await applyChargeSuccess({
        orgId, customerCode, planKey, cycle,
        reference: tx.reference, amountUsd: tx.amount ? tx.amount / 100 : null, rawEvent: tx
      });
      res.redirect('/billing?checkout=success');
    } else {
      res.redirect('/billing?checkout=pending');
    }
  } catch (err) {
    console.error('Paystack callback verification failed:', err.message);
    res.redirect('/billing?checkout=pending');
  }
});

// --- Cancel the current subscription. Access continues until
// current_period_end (unchanged here); the lazy check in
// lib/plans.js#syncOrgPlan handles the actual downgrade once that date
// passes. ---
router.post('/billing/cancel', requireAuth, requireOrg, requireOrgRole('admin'), async (req, res) => {
  const org = await getOrgById(req.orgId);
  if (!org.paystack_subscription_code || !org.paystack_email_token) {
    return res.redirect('/billing?error=nothing-to-cancel');
  }
  try {
    await paystack.disableSubscription(org.paystack_subscription_code, org.paystack_email_token);
    // subscription_status flips to 'canceled' for real once the
    // subscription.disable webhook arrives -- this just gives immediate
    // feedback in case the admin reloads before that happens.
    res.redirect('/billing?checkout=cancel-requested');
  } catch (err) {
    console.error('Paystack subscription cancel failed:', err.message);
    res.redirect('/billing?error=cancel-failed');
  }
});

module.exports = router;
