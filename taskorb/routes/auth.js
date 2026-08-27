const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { uniqueSlug, getUserOrgs } = require('../lib/org');

const router = express.Router();

// Wipes and replaces the session ID on the authentication boundary
// (anonymous -> logged in), so a session ID an attacker planted before
// login can't be reused afterward (session fixation).
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, currentUser: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase().trim()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.render('login', { error: 'Incorrect email or password.', currentUser: null });
    }

    const orgs = await getUserOrgs(user.id, user.is_platform_admin);

    await regenerateSession(req);
    req.session.user = { id: user.id, name: user.name, email: user.email, default_template: user.default_template, is_platform_admin: user.is_platform_admin };

    // Auto-pick the org if there's only one; otherwise send them to the
    // switcher. (Zero orgs shouldn't happen -- registration always creates
    // one -- but /orgs handles that gracefully too, just in case.)
    if (orgs.length === 1) {
      req.session.orgId = orgs[0].id;
      return res.redirect('/');
    }
    req.session.orgId = null;
    res.redirect('/orgs');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Something went wrong. Try again.', currentUser: null });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Self-serve signup. Always creates a brand-new organization. If the email
// already has an account, this attaches a new org to that existing account
// (password required to prove it's really them) rather than erroring --
// that's how one login can end up belonging to several organizations.
router.get('/register', (req, res) => {
  res.render('register', { error: null, currentUser: null });
});

router.post('/register', async (req, res) => {
  const { org_name, name, email, password } = req.body;
  const render = (error) => res.render('register', { error, currentUser: null });

  if (!org_name || !org_name.trim()) return render('Give your organization a name.');
  if (!name || !name.trim() || !email || !email.trim() || !password) return render('Fill out every field.');

  const normalizedEmail = email.toLowerCase().trim();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    let userId;

    if (existingRows[0]) {
      const existing = existingRows[0];
      if (!(await bcrypt.compare(password, existing.password_hash))) {
        await client.query('ROLLBACK');
        return render('That email already has an account -- enter its password to add a new organization, or log in instead.');
      }
      userId = existing.id;
    } else {
      if (password.length < 6) {
        await client.query('ROLLBACK');
        return render('Password needs to be at least 6 characters.');
      }
      const hash = await bcrypt.hash(password, 10);
      const { rows: inserted } = await client.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [name.trim(), normalizedEmail, hash]
      );
      userId = inserted[0].id;
    }

    const slug = await uniqueSlug(org_name);
    const { rows: orgRows } = await client.query(
      'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
      [org_name.trim(), slug]
    );
    const orgId = orgRows[0].id;
    await client.query("INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'admin')", [orgId, userId]);

    await client.query('COMMIT');

    const { rows: userRows } = await pool.query('SELECT id, name, email, default_template, is_platform_admin FROM users WHERE id = $1', [userId]);

    await regenerateSession(req);
    req.session.user = userRows[0];
    req.session.orgId = orgId;
    res.redirect('/');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    render('Could not create your organization. Try again.');
  } finally {
    client.release();
  }
});

module.exports = router;
