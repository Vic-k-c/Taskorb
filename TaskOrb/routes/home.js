const express = require('express');
const router = express.Router();

// GET / is normally the authenticated dashboard (see routes/dashboard.js).
// This router is mounted before it: logged-out visitors get the marketing
// landing page here and the response ends; logged-in visitors fall through
// via next() to the dashboard route as before.
router.get('/', (req, res, next) => {
  if (req.session && req.session.user) return next();
  res.render('landing');
});

module.exports = router;
