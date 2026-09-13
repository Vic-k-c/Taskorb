// Error logging/monitoring. Always logs to console (which Render's Logs tab
// captures -- that's real, usable monitoring on its own, free, zero setup).
// Optionally also forwards to Sentry if SENTRY_DSN is configured.
//
// Deliberately uses only Sentry.init() and Sentry.captureException() -- the
// two most stable, long-standing entry points in the SDK -- rather than the
// Express-specific auto-instrumentation helpers, whose API has changed
// across SDK major versions. Lower surface area to break without network
// access here to verify the currently-installed version's exact API.

let Sentry = null;
let sentryEnabled = false;

function init() {
  if (!process.env.SENTRY_DSN) {
    console.log('SENTRY_DSN not set -- errors will be logged to console only.');
    return;
  }
  try {
    Sentry = require('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 });
    sentryEnabled = true;
    console.log('Sentry error monitoring enabled.');
  } catch (err) {
    console.error('Could not initialize Sentry (continuing with console-only logging):', err.message);
  }
}

function captureError(err, context) {
  console.error('[error]', context ? JSON.stringify(context) : '', err && err.stack ? err.stack : err);
  if (sentryEnabled && Sentry) {
    try {
      Sentry.captureException(err, context ? { extra: context } : undefined);
    } catch (sentryErr) {
      console.error('Sentry capture failed:', sentryErr.message);
    }
  }
}

// Express error-handling middleware (4-arg signature required by Express to
// be recognized as an error handler). Catches anything that reaches it --
// most routes already handle their own errors and respond directly, so this
// is mainly a safety net plus the single place that guarantees clients
// never see a raw stack trace.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  captureError(err, {
    method: req.method,
    path: req.path,
    userId: req.session && req.session.user ? req.session.user.id : null,
    orgId: req.orgId || (req.session && req.session.orgId) || null
  });
  const wantsJson = req.path.startsWith('/api/') || (req.get('accept') || '').includes('application/json');
  if (wantsJson) return res.status(500).json({ error: 'Something went wrong on our end.' });
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: "That's on us, not you. Try again in a moment.",
    currentUser: (req.session && req.session.user) || null
  });
}

module.exports = { init, captureError, errorHandler };
