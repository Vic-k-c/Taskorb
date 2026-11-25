const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Classic synchronizer token pattern: one random token per session, echoed
// back by the client on every mutating request (as a hidden form field for
// real HTML forms, or an `x-csrf-token` header for fetch() calls -- see
// public/js/csrf.js, which patches fetch to add that header automatically).
// Implemented by hand rather than pulling in a third-party CSRF package,
// since this codebase can't install/verify a package's current API here.
function csrfProtection(req, res, next) {
  if (!req.session) return next();

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();

  const provided = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!provided || provided !== req.session.csrfToken) {
    // Every traditional (non-fetch) HTML form in this app submits as
    // urlencoded; every fetch()-based call sends JSON or multipart, or has
    // no body at all (a plain DELETE). That split is a much more reliable
    // signal than guessing from the URL path, since several fetch-based
    // routes (e.g. PATCH /boards/:id, POST /orgs/:id) don't happen to live
    // under /api/ -- an earlier version of this check missed those and
    // would have sent them an HTML error page their `.then(r => r.json())`
    // couldn't parse.
    const contentType = req.get('content-type') || '';
    const isTraditionalForm = contentType.includes('application/x-www-form-urlencoded');
    if (isTraditionalForm) {
      return res.status(403).render('error', {
        title: 'Request could not be verified',
        message: 'This usually means the page was open a long time, or the request came from somewhere it shouldn\'t have. Refresh the page and try again.',
        currentUser: req.session.user || null
      });
    }
    return res.status(403).json({ error: 'Your session expired or this request could not be verified. Refresh the page and try again.' });
  }
  next();
}

module.exports = { csrfProtection };
