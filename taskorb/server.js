require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const methodOverride = require('method-override');
const rateLimit = require('express-rate-limit');
const path = require('path');

const pool = require('./db/pool');
const monitoring = require('./lib/monitoring');
const { csrfProtection } = require('./lib/csrf');
const { getUserOrgs } = require('./lib/org');

monitoring.init();

const app = express();
const PORT = process.env.PORT || 3000;

// Render (and most PaaS hosts) terminate HTTPS at a proxy in front of the app
// and forward requests over plain HTTP internally. Without this, Express
// thinks every request is insecure, so a cookie marked `secure: true` never
// actually gets set — sessions silently fail to persist after login. It's
// also what makes express-rate-limit key off the real client IP instead of
// Render's proxy IP for every request.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// --- Rate limiting ---
// Generous global ceiling just to blunt outright abuse/scraping.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false
}));
// Tighter limit specifically on auth endpoints, where the real risk
// (credential stuffing, password brute-forcing) actually lives.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a few minutes and try again.' }
});
app.use(['/login', '/register'], authLimiter);

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  name: 'taskorb.sid', // don't leave the default 'connect.sid' advertising the framework
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // active users stay logged in; idle sessions still expire on schedule
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week, refreshed on activity via `rolling`
    httpOnly: true, // no client-side JS access to the cookie (default true, but explicit)
    sameSite: 'lax', // blocks the cookie from riding along on cross-site form posts; defense in depth alongside CSRF tokens
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(csrfProtection);

// Make currentUser AND org context available to every view without
// repeating it in every render(). One extra query per authenticated
// request -- acceptable at this scale; worth caching if it ever isn't.
app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.userOrgs = [];
  res.locals.currentOrg = null;
  if (req.session.user) {
    try {
      const orgs = await getUserOrgs(req.session.user.id, req.session.user.is_platform_admin);
      res.locals.userOrgs = orgs;
      res.locals.currentOrg = req.session.orgId ? (orgs.find((o) => o.id === req.session.orgId) || null) : null;
    } catch (err) {
      console.error('Failed to load org context:', err.message);
    }
  }
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/orgs'));
app.use('/', require('./routes/platform'));
app.use('/', require('./routes/account'));
app.use('/', require('./routes/users'));
app.use('/', require('./routes/boards'));
app.use('/', require('./routes/map'));
app.use('/', require('./routes/cards'));
app.use('/', require('./routes/notifications'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/export'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: "That page doesn't exist.", currentUser: req.session.user || null });
});

// Must be registered last -- Express recognizes an error handler by its
// 4-argument signature.
app.use(monitoring.errorHandler);

// Catch anything that happens outside a request entirely (a rejected
// promise nobody awaited, a genuinely uncaught throw). Render restarts the
// process after a crash regardless, so this just makes sure we see it
// first instead of losing it to a silent exit.
process.on('unhandledRejection', (err) => monitoring.captureError(err, { source: 'unhandledRejection' }));
process.on('uncaughtException', (err) => {
  monitoring.captureError(err, { source: 'uncaughtException' });
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`TaskOrb running on http://localhost:${PORT}`);
});
