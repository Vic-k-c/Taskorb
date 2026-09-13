const pool = require('../db/pool');

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'org';
}

async function uniqueSlug(base) {
  const root = slugify(base);
  let slug = root;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rows } = await pool.query('SELECT 1 FROM organizations WHERE slug = $1', [slug]);
    if (!rows[0]) return slug;
    n += 1;
    slug = `${root}-${n}`;
  }
}

async function getOrgRole(userId, orgId, isPlatformAdmin) {
  if (!orgId) return null;
  // Platform admins (the SaaS operator) get admin-level access to every
  // org for support/billing purposes, without needing an org_members row
  // in each one -- that would mean manually adding them to every future
  // org, which defeats the point.
  if (isPlatformAdmin) return 'admin';
  const { rows } = await pool.query('SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
  return rows[0] ? rows[0].role : null;
}

// Every org a user belongs to, with their role in each -- used for the org
// switcher in the nav and the /orgs picker page. Platform admins see every
// organization on the platform, not just ones they're formally a member of.
async function getUserOrgs(userId, isPlatformAdmin) {
  if (isPlatformAdmin) {
    const { rows } = await pool.query(`SELECT id, name, slug, 'admin' AS role FROM organizations ORDER BY name ASC`);
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT o.id, o.name, o.slug, om.role
     FROM organizations o
     JOIN org_members om ON om.org_id = o.id
     WHERE om.user_id = $1
     ORDER BY o.name ASC`,
    [userId]
  );
  return rows;
}

// Route-level gate for full-PAGE loads: redirects to the org picker if
// there's no active org. Relies on res.locals.currentOrg / userOrgs already
// computed by the app-wide middleware in server.js.
function requireOrg(req, res, next) {
  if (!res.locals.currentOrg) {
    return res.redirect('/orgs');
  }
  req.orgId = res.locals.currentOrg.id;
  req.orgRole = res.locals.currentOrg.role;
  next();
}

// Same check, but for JSON/API routes -- returns a 400 instead of
// redirecting, since a fetch() call can't usefully follow a redirect to an
// HTML page.
function requireOrgApi(req, res, next) {
  if (!res.locals.currentOrg) {
    return res.status(400).json({ error: 'No active organization. Pick one from the org switcher first.' });
  }
  req.orgId = res.locals.currentOrg.id;
  req.orgRole = res.locals.currentOrg.role;
  next();
}

function requireOrgRole(...roles) {
  return (req, res, next) => {
    if (!req.orgId || !roles.includes(req.orgRole)) {
      return res.status(403).render('error', {
        title: 'Access denied',
        message: "You don't have permission to view this page.",
        currentUser: req.session.user || null
      });
    }
    next();
  };
}

function requirePlatformAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_platform_admin) {
    return res.status(403).render('error', {
      title: 'Access denied',
      message: "You don't have permission to view this page.",
      currentUser: req.session.user || null
    });
  }
  next();
}

module.exports = { slugify, uniqueSlug, getOrgRole, getUserOrgs, requireOrg, requireOrgApi, requireOrgRole, requirePlatformAdmin };
