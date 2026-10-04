const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireOrg, requireOrgApi } = require('../lib/org');
const { getBoardIdForCard, getBoardPermission, atLeast } = require('../lib/access');
const followups = require('../lib/followups');

const router = express.Router();

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// --- Calendar page ----------------------------------------------------
// Every follow-up the viewer is allowed to see: org admins see the whole
// org, everyone else only boards they're a member of -- the same rule the
// map uses for pins (routes/map.js).
router.get('/calendar', requireAuth, requireOrg, async (req, res) => {
  const isOrgAdmin = req.orgRole === 'admin';
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.phone, c.address, c.follow_up_at, c.follow_up_remind_before,
            c.assigned_to, c.follow_up_set_by, u.name AS assigned_name,
            l.name AS list_name, b.id AS board_id, b.title AS board_title
     FROM cards c
     JOIN lists l ON l.id = c.list_id
     JOIN boards b ON b.id = l.board_id
     ${isOrgAdmin ? '' : 'JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $2'}
     LEFT JOIN users u ON u.id = c.assigned_to
     WHERE c.follow_up_at IS NOT NULL AND b.org_id = $1
       AND c.follow_up_at >= NOW() - INTERVAL '60 days'
     ORDER BY c.follow_up_at ASC
     LIMIT 1000`,
    isOrgAdmin ? [req.orgId] : [req.orgId, req.session.user.id]
  );
  res.render('calendar', {
    followUps: rows,
    meId: req.session.user.id,
    pushAvailable: followups.pushEnabled(),
    currentUser: req.session.user
  });
});

// --- Add-to-calendar for one card -------------------------------------
async function loadCardForCalendar(req, res) {
  const boardId = await getBoardIdForCard(req.params.id);
  if (!boardId) { res.status(404).send('Card not found.'); return null; }
  const permission = await getBoardPermission(req.session.user.id, boardId, req.orgId, req.orgRole);
  if (!permission || !atLeast(permission, 'viewer')) { res.status(403).send('No access to this card.'); return null; }
  const { rows } = await pool.query(
    `SELECT c.*, b.id AS board_id FROM cards c JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id WHERE c.id = $1`,
    [req.params.id]
  );
  const card = rows[0];
  if (!card || !card.follow_up_at) { res.status(404).send('This card has no follow-up scheduled.'); return null; }
  return card;
}

router.get('/cards/:id/follow-up.ics', requireAuth, requireOrg, async (req, res) => {
  const card = await loadCardForCalendar(req, res);
  if (!card) return;
  const safeName = card.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'follow-up';
  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="follow-up-${safeName}.ics"`
  });
  res.send(followups.buildIcs(card, baseUrl(req)));
});

router.get('/cards/:id/follow-up/google', requireAuth, requireOrg, async (req, res) => {
  const card = await loadCardForCalendar(req, res);
  if (!card) return;
  res.redirect(followups.googleCalendarUrl(card, baseUrl(req)));
});

// --- Web Push subscription management ---------------------------------
router.get('/api/push/config', requireAuth, async (req, res) => {
  res.json({
    enabled: followups.pushEnabled(),
    publicKey: followups.pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
    deviceCount: await followups.pushSubscriptionCount(req.session.user.id)
  });
});

router.post('/api/push/subscribe', requireAuth, async (req, res) => {
  if (!followups.pushEnabled()) return res.status(503).json({ error: 'Push notifications are not configured on this server.' });
  try {
    await followups.savePushSubscription(req.session.user.id, req.body.subscription, req.get('user-agent'));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
  if (req.body.endpoint) await followups.removePushSubscription(req.session.user.id, req.body.endpoint);
  res.json({ ok: true });
});

router.post('/api/push/test', requireAuth, async (req, res) => {
  if (!followups.pushEnabled()) return res.status(503).json({ error: 'Push notifications are not configured on this server.' });
  const sent = await followups.sendPushToUser(req.session.user.id, {
    title: 'TaskOrb notifications are on',
    body: 'You will get follow-up reminders on this device.',
    url: '/calendar',
    tag: 'taskorb-test'
  });
  res.json({ sent });
});

module.exports = router;
