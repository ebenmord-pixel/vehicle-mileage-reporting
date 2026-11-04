const { isAdmin } = require('./helpers');

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(403).render('error', { title: 'אין הרשאה', message: 'עמוד זה מיועד למנהל המערכת בלבד' });
  next();
}

function forbidden(res, message = 'אין לך הרשאה לפעולה זו') {
  return res.status(403).render('error', { title: 'אין הרשאה', message });
}

function notFound(res, message = 'הפריט לא נמצא') {
  return res.status(404).render('error', { title: 'לא נמצא', message });
}

module.exports = { requireLogin, requireAdmin, forbidden, notFound };
