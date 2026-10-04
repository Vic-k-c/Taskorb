const pool = require('../db/pool');
const { notify } = require('./notify');

// web-push is loaded defensively: if the package isn't installed yet (or
// VAPID keys aren't configured) everything else about follow-ups --
// scheduling, the calendar page, .ics/Google links, bell notifications --
// keeps working; only device push is skipped.
let webpush = null;
try { webpush = require('web-push'); } catch (e) { /* not installed */ }

const REMIND_OPTIONS = [0, 15, 60, 1440]; // minutes before the follow-up
const DEFAULT_REMIND_BEFORE = 60;
const DEFAULT_DURATION_MIN = 30;
// A reminder that is more than this far past its follow-up time is
// considered stale (e.g. the server was down for a day) -- it's claimed so
// it doesn't linger, but not sent, rather than pinging someone about
// yesterday's appointment.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

let pushConfigured = false;
function configurePush() {
  if (pushConfigured) return true;
  if (!webpush || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@taskorb.net',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  pushConfigured = true;
  return true;
}
function pushEnabled() { return configurePush(); }

// ---------------------------------------------------------------------
// Set / clear
// ---------------------------------------------------------------------

// followUpAt: ISO string or Date, or null to clear.
async function setFollowUp(cardId, userId, followUpAt, remindBefore) {
  if (followUpAt === null || followUpAt === undefined || followUpAt === '') {
    await pool.query(
      `UPDATE cards SET follow_up_at = NULL, follow_up_remind_at = NULL,
              follow_up_reminded_at = NULL, follow_up_set_by = NULL, updated_at = NOW()
       WHERE id = $1`,
      [cardId]
    );
    return null;
  }
  const when = new Date(followUpAt);
  if (Number.isNaN(when.getTime())) throw new Error('That date/time is not valid.');
  const minutes = REMIND_OPTIONS.includes(Number(remindBefore)) ? Number(remindBefore) : DEFAULT_REMIND_BEFORE;
  const remindAt = new Date(when.getTime() - minutes * 60 * 1000);
  // If the reminder moment has already passed (e.g. a follow-up set for 20
  // minutes from now with a 1-hour lead), don't fire an instant ping --
  // mark it as already handled. The person just set this; they know.
  const alreadyDue = remindAt.getTime() <= Date.now();
  const { rows } = await pool.query(
    `UPDATE cards
     SET follow_up_at = $2, follow_up_remind_before = $3, follow_up_remind_at = $4,
         follow_up_reminded_at = $5, follow_up_set_by = $6, updated_at = NOW()
     WHERE id = $1
     RETURNING id, follow_up_at, follow_up_remind_before, follow_up_remind_at`,
    [cardId, when, minutes, remindAt, alreadyDue ? new Date() : null, userId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Calendar links: .ics (works with Apple / Outlook / Google / anything)
// and a Google Calendar deep link.
// ---------------------------------------------------------------------

function icsTime(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsEscape(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
// RFC 5545: lines are limited to 75 octets and continue with CRLF + space.
function foldLine(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    // Don't split inside a multi-byte character.
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

function eventDetails(card, baseUrl) {
  const lines = [];
  if (card.phone) lines.push(`Phone: ${card.phone}`);
  if (card.email) lines.push(`Email: ${card.email}`);
  if (card.notes) lines.push(card.notes);
  lines.push(`Open in TaskOrb: ${baseUrl}/boards/${card.board_id}`);
  return lines.join('\n');
}

function buildIcs(card, baseUrl) {
  const start = new Date(card.follow_up_at);
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
  const alarm = Number(card.follow_up_remind_before);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TaskOrb//Follow-up//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:followup-${card.id}-${start.getTime()}@taskorb`,
    `DTSTAMP:${icsTime(new Date())}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEscape(`Follow-up: ${card.name}`)}`,
    `DESCRIPTION:${icsEscape(eventDetails(card, baseUrl))}`
  ];
  if (card.address) lines.push(`LOCATION:${icsEscape(card.address)}`);
  lines.push(`URL:${baseUrl}/boards/${card.board_id}`);
  if (alarm > 0) {
    lines.push('BEGIN:VALARM', `TRIGGER:-PT${alarm}M`, 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`Follow-up: ${card.name}`)}`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function googleCalendarUrl(card, baseUrl) {
  const start = new Date(card.follow_up_at);
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Follow-up: ${card.name}`,
    dates: `${icsTime(start)}/${icsTime(end)}`,
    details: eventDetails(card, baseUrl)
  });
  if (card.address) params.set('location', card.address);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------

async function savePushSubscription(userId, sub, userAgent) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('Incomplete push subscription.');
  }
  // Same device re-subscribing (or a different user signing in on the
  // same browser) just re-points the existing endpoint row.
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, (userAgent || '').slice(0, 300)]
  );
}

async function removePushSubscription(userId, endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
}

async function pushSubscriptionCount(userId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE user_id = $1', [userId]);
  return rows[0].count;
}

async function sendPushToUser(userId, payload) {
  if (!configurePush()) return 0;
  const { rows: subs } = await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 }
      );
      sent++;
    } catch (err) {
      // 404/410 = the browser unsubscribed or the subscription expired;
      // keeping it would just fail on every future reminder.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
      } else {
        console.error('Web push send failed:', err.statusCode || '', err.message);
      }
    }
  }));
  return sent;
}

// ---------------------------------------------------------------------
// Reminder dispatch
// ---------------------------------------------------------------------

const WHEN_LABEL = { 0: 'is due now', 15: 'is in 15 minutes', 60: 'is in 1 hour', 1440: 'is tomorrow' };

// Claims every due, unsent reminder in ONE atomic UPDATE...RETURNING, so
// two dispatchers running at the same instant (the in-process timer and an
// external cron ping, say) can never both send the same reminder.
async function sendDueReminders() {
  const { rows: claimed } = await pool.query(
    `UPDATE cards c
     SET follow_up_reminded_at = NOW()
     FROM lists l, boards b
     WHERE c.list_id = l.id AND l.board_id = b.id
       AND c.follow_up_at IS NOT NULL
       AND c.follow_up_reminded_at IS NULL
       AND c.follow_up_remind_at <= NOW()
     RETURNING c.id, c.name, c.follow_up_at, c.follow_up_remind_before,
               c.assigned_to, c.follow_up_set_by, b.id AS board_id, b.org_id`
  );

  let delivered = 0;
  for (const card of claimed) {
    if (Date.now() - new Date(card.follow_up_at).getTime() > STALE_AFTER_MS) continue;
    const recipients = [...new Set([card.assigned_to, card.follow_up_set_by].filter(Boolean))];
    const label = WHEN_LABEL[card.follow_up_remind_before] || 'is coming up';
    const message = `Follow-up with "${card.name}" ${label}.`;
    const link = `/boards/${card.board_id}`;
    for (const userId of recipients) {
      await notify(userId, card.org_id, message, link, 'reminder');
      await sendPushToUser(userId, {
        title: 'Follow-up reminder',
        body: message,
        url: link,
        tag: `followup-${card.id}`
      });
      delivered++;
    }
  }
  return { claimed: claimed.length, delivered };
}

let loopTimer = null;
let running = false;
// Checks once a minute while the process is awake. On a host that sleeps
// idle services (Render's free plan), pair this with an external pinger
// hitting /cron/reminders every few minutes -- see routes/webhooks.js.
function startReminderLoop() {
  if (loopTimer) return;
  loopTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await sendDueReminders(); } catch (err) { console.error('Reminder loop failed:', err.message); }
    running = false;
  }, 60 * 1000);
  loopTimer.unref();
}

module.exports = {
  REMIND_OPTIONS,
  setFollowUp,
  buildIcs,
  googleCalendarUrl,
  pushEnabled,
  savePushSubscription,
  removePushSubscription,
  pushSubscriptionCount,
  sendPushToUser,
  sendDueReminders,
  startReminderLoop
};
