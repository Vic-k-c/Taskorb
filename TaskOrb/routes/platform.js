const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../lib/org');
const { getPlan, PLAN_ORDER, LEGACY_PLAN_MAP, applyLegacySubscription } = require('../lib/plans');
const paystack = require('../lib/paystack');
const { pushStatus } = require('../lib/followups');

const router = express.Router();

router.get('/platform', requireAuth, requirePlatformAdmin, async (req, res) => {
  const { rows: orgs } = await pool.query(`
    SELECT o.id, o.name, o.slug, o.created_at, o.plan_key, o.billing_cycle, o.subscription_status,
           (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id) AS member_count,
           (SELECT COUNT(*) FROM boards b WHERE b.org_id = o.id) AS board_count
    FROM organizations o
    ORDER BY o.created_at DESC
  `);
  const { rows: totals } = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM organizations) AS org_count,
           (SELECT COUNT(*)::int FROM users) AS user_count,
           (SELECT COUNT(*)::int FROM boards) AS board_count,
           (SELECT COUNT(*)::int FROM cards) AS card_count
  `);

  // Every platform user, with which org(s) they belong to and in what
  // role -- a user can be in more than one org, hence the array_agg.
  const { rows: users } = await pool.query(`
    SELECT u.id, u.name, u.email, u.is_platform_admin, u.created_at,
           COALESCE(
             array_agg(o.name || ':' || om.role ORDER BY o.name) FILTER (WHERE o.id IS NOT NULL),
             ARRAY[]::text[]
           ) AS org_memberships
    FROM users u
    LEFT JOIN org_members om ON om.user_id = u.id
    LEFT JOIN organizations o ON o.id = om.org_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);

  // How many orgs sit on each plan right now, and a rough MRR estimate
  // (annual subscriptions counted at 1/12th their price) -- "rough"
  // because it doesn't account for a plan change mid-cycle or a trial
  // that hasn't converted yet.
  const { rows: planCounts } = await pool.query(`
    SELECT plan_key, subscription_status, billing_cycle, COUNT(*)::int AS count
    FROM organizations
    GROUP BY plan_key, subscription_status, billing_cycle
  `);
  let mrrEstimate = 0;
  const planBreakdown = PLAN_ORDER.filter((k) => k !== 'free').map((key) => {
    const plan = getPlan(key);
    const rowsForPlan = planCounts.filter((r) => r.plan_key === key && r.subscription_status === 'active');
    const activeCount = rowsForPlan.reduce((sum, r) => sum + r.count, 0);
    rowsForPlan.forEach((r) => {
      const price = r.billing_cycle === 'annual' ? plan.priceAnnual / 12 : plan.priceMonthly;
      mrrEstimate += price * r.count;
    });
    return { plan, activeCount };
  });
  const trialCount = planCounts.filter((r) => r.subscription_status === 'trial').reduce((sum, r) => sum + r.count, 0);
  const freeCount = planCounts.filter((r) => r.plan_key === 'free').reduce((sum, r) => sum + r.count, 0);

  const { rows: recentTransactions } = await pool.query(`
    SELECT bt.*, o.name AS org_name
    FROM billing_transactions bt
    JOIN organizations o ON o.id = bt.org_id
    ORDER BY bt.created_at DESC
    LIMIT 25
  `);

  // Reminder / device-notification health, so "why didn't it notify me"
  // can be answered from this page instead of the server logs.
  const { rows: pushRows } = await pool.query(
    'SELECT COUNT(*)::int AS devices, COUNT(DISTINCT user_id)::int AS people FROM push_subscriptions'
  );
  const { rows: dateRows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE follow_up_at > NOW())::int AS upcoming,
            COUNT(*) FILTER (WHERE follow_up_at > NOW() AND follow_up_reminded_at IS NULL)::int AS pending
     FROM cards`
  );
  const push = pushStatus();
  const pushInfo = {
    enabled: push.enabled, reason: push.reason,
    devices: pushRows[0].devices, people: pushRows[0].people,
    upcoming: dateRows[0].upcoming, pending: dateRows[0].pending,
    cronConfigured: !!process.env.CRON_SECRET
  };

  res.render('platform', {
    pushInfo,
    orgs, totals: totals[0], users, planBreakdown, trialCount, freeCount,
    mrrEstimate: Math.round(mrrEstimate * 100) / 100,
    recentTransactions,
    currentUser: req.session.user
  });
});

// --- Paystack customer lookup tool: look up any email directly against
// live Paystack, see their real subscriptions/plan codes, and check them
// against LEGACY_PAYSTACK_PLAN_MAP without needing to cross-reference
// Render/Paystack manually. Also lets you apply a match directly to
// their org, right here -- the UI equivalent of db/migrate-subscription.js. ---
router.get('/platform/paystack-lookup', requireAuth, requirePlatformAdmin, async (req, res) => {
  const email = (req.query.email || '').trim();
  let customer = null;
  let lookupError = null;
  let targetOrg = null;
  let orgOptions = [];

  if (email) {
    try {
      customer = await paystack.getCustomer(email);
    } catch (err) {
      lookupError = err.message;
    }
    const { rows: users } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (users[0]) {
      const { rows: orgs } = await pool.query(
        `SELECT o.id, o.name, o.plan_key, om.role FROM organizations o
         JOIN org_members om ON om.org_id = o.id
         WHERE om.user_id = $1 ORDER BY o.id ASC`,
        [users[0].id]
      );
      orgOptions = orgs;
      if (orgs.length === 1) targetOrg = orgs[0];
    }
  }

  res.render('platform-paystack-lookup', {
    email, customer, lookupError, targetOrg, orgOptions,
    legacyMapEntries: Object.entries(LEGACY_PLAN_MAP),
    getPlan,
    applied: req.query.applied === '1',
    error: req.query.error || null,
    currentUser: req.session.user
  });
});

router.post('/platform/paystack-lookup/apply', requireAuth, requirePlatformAdmin, async (req, res) => {
  const { email, orgId, planKey, cycle, customerCode, subscriptionCode, emailToken, nextPaymentDate } = req.body;
  try {
    await applyLegacySubscription(Number(orgId), {
      planKey, cycle, customerCode, subscriptionCode, emailToken,
      nextPaymentDate: nextPaymentDate || null
    });
    res.redirect(`/platform/paystack-lookup?email=${encodeURIComponent(email)}&applied=1`);
  } catch (err) {
    console.error('Manual legacy-subscription apply failed:', err.message);
    res.redirect(`/platform/paystack-lookup?email=${encodeURIComponent(email)}&error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
