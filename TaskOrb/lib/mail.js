// Sends email through Resend's HTTPS API (no extra npm package needed).
// Set RESEND_API_KEY and MAIL_FROM (e.g. "TaskOrb <no-reply@taskorb.net>",
// on a domain verified in Resend). Unset = email disabled; callers fall back
// to the platform-admin "copy reset link" route.
function mailEnabled() {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled()) return { sent: false, reason: 'Email is not configured (RESEND_API_KEY / MAIL_FROM).' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, html })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { sent: false, reason: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendMail, mailEnabled };
