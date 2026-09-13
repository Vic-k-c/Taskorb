function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.locals.currentUser = req.session.user;
  next();
}

// Note: per-org roles (admin/leader/member) now live in org_members, not on
// the user record -- see lib/org.js's requireOrgRole() for that check.
// This file only handles "are you logged in at all".
module.exports = { requireAuth };
