function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  res.locals.currentUser = req.session.user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'Access denied',
        message: "You don't have permission to view this page.",
        currentUser: req.session.user
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
