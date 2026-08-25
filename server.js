require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const methodOverride = require('method-override');
const path = require('path');

const pool = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3000;

// Render (and most PaaS hosts) terminate HTTPS at a proxy in front of the app
// and forward requests over plain HTTP internally. Without this, Express
// thinks every request is insecure, so a cookie marked `secure: true` never
// actually gets set — sessions silently fail to persist after login.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Make currentUser available to every view without repeating it in every render()
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use('/', require('./routes/auth'));
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

app.listen(PORT, () => {
  console.log(`TaskOrb running on http://localhost:${PORT}`);
});
