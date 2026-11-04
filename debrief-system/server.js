require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const { q, settings } = require('./src/db');
const mailer = require('./src/mailer');
const scheduler = require('./src/scheduler');
const { viewLocals } = require('./src/helpers');

const app = express();
const PORT = process.env.PORT || 3100;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 10 }
}));

const locals = viewLocals();
app.use((req, res, next) => {
  const sessionUser = req.session.userId ? q.user(req.session.userId) : null;
  if (req.session.userId && (!sessionUser || sessionUser.active === false)) {
    req.session.userId = null;
  }
  req.user = sessionUser && sessionUser.active !== false ? sessionUser : null;
  Object.assign(res.locals, locals);
  res.locals.user = req.user;
  res.locals.path = req.path;
  res.locals.flash = req.session.flash || [];
  res.locals.mailConfigured = mailer.isConfigured();
  res.locals.settings = settings();
  req.session.flash = [];
  next();
});

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/respond'));
app.use(require('./src/routes/dashboard'));
app.use(require('./src/routes/debriefs'));
app.use(require('./src/routes/meeting'));
app.use(require('./src/routes/tasks'));
app.use(require('./src/routes/tracking'));
app.use(require('./src/routes/attachments'));
app.use(require('./src/routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'לא נמצא', message: 'העמוד המבוקש לא נמצא' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'שגיאה', message: err.message || 'אירעה שגיאה' });
});

app.listen(PORT, () => {
  console.log(`מערכת ניהול תחקירים פועלת: http://localhost:${PORT}`);
  if (!mailer.isConfigured()) console.log('שים לב: SMTP לא מוגדר — מיילים יישמרו ב-data/outbox.log במקום להישלח.');
  scheduler.start();
});
