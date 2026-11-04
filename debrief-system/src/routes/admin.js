const express = require('express');
const bcrypt = require('bcryptjs');
const { q, mutate, nextId, settings, DEFAULT_SETTINGS } = require('../db');
const scheduler = require('../scheduler');
const mailer = require('../mailer');
const { requireLogin, requireAdmin, notFound } = require('../auth');
const { flash } = require('../helpers');
const { sendMail, layout, baseUrl, escapeHtml } = require('../mailer');

const router = express.Router();
router.use('/admin', requireLogin, requireAdmin);

router.get('/admin/users', (req, res) => {
  res.render('admin/users', { title: 'ניהול משתמשים', users: q.users(), departments: q.departments() });
});

router.get('/admin/users/new', (req, res) => {
  res.render('admin/user-form', { title: 'משתמש חדש', u: null, departments: q.departments() });
});

router.get('/admin/users/:id(\\d+)/edit', (req, res) => {
  const u = q.user(req.params.id);
  if (!u) return notFound(res);
  res.render('admin/user-form', { title: 'עריכת משתמש', u, departments: q.departments() });
});

function userFields(body) {
  return {
    fullName: (body.fullName || '').trim(),
    username: (body.username || '').trim(),
    email: (body.email || '').trim(),
    jobTitle: (body.jobTitle || '').trim(),
    phone: (body.phone || '').trim(),
    departmentId: Number(body.departmentId) || null,
    role: body.role === 'admin' ? 'admin' : 'user',
    active: body.active !== 'off'
  };
}

router.post('/admin/users', async (req, res) => {
  const f = userFields(req.body);
  const password = req.body.password || '';
  if (!f.fullName || !f.username || password.length < 6) {
    flash(req, 'error', 'חובה: שם מלא, שם משתמש וסיסמה (לפחות 6 תווים)');
    return res.redirect('/admin/users/new');
  }
  if (q.userByUsername(f.username)) { flash(req, 'error', 'שם המשתמש כבר קיים'); return res.redirect('/admin/users/new'); }
  mutate(db => db.users.push({ id: nextId(db, 'user'), ...f, passwordHash: bcrypt.hashSync(password, 10) }));
  if (req.body.sendWelcome === 'on' && f.email) {
    const r = await sendMail({
      to: f.email,
      subject: 'נפתח עבורך משתמש במערכת ניהול התחקירים',
      html: layout({
        heading: 'ברוכים הבאים למערכת ניהול התחקירים',
        paragraphs: [`שלום ${escapeHtml(f.fullName)},`, `שם המשתמש שלך: <b dir="ltr">${escapeHtml(f.username)}</b>`, 'את הסיסמה הראשונית תקבל/י ממנהל המערכת. מומלץ להחליף אותה לאחר הכניסה הראשונה (בעמוד "הפרופיל שלי").'],
        button: { label: 'כניסה למערכת', url: `${baseUrl()}/login` }
      }),
      text: `נפתח עבורך משתמש: ${f.username}. ${baseUrl()}/login`
    });
    if (!r.sent) flash(req, 'warning', `מייל הפתיחה לא נשלח: ${r.reason}`);
  }
  flash(req, 'success', 'המשתמש נוצר');
  res.redirect('/admin/users');
});

router.post('/admin/users/:id(\\d+)', (req, res) => {
  const u = q.user(req.params.id);
  if (!u) return notFound(res);
  const f = userFields(req.body);
  if (!f.fullName || !f.username) { flash(req, 'error', 'חובה: שם מלא ושם משתמש'); return res.redirect(`/admin/users/${u.id}/edit`); }
  const other = q.userByUsername(f.username);
  if (other && other.id !== u.id) { flash(req, 'error', 'שם המשתמש כבר קיים'); return res.redirect(`/admin/users/${u.id}/edit`); }
  if (u.id === req.user.id) { f.role = 'admin'; f.active = true; } // מניעת נעילה עצמית
  mutate(db => {
    const x = db.users.find(y => y.id === u.id);
    Object.assign(x, f);
    if (req.body.password) x.passwordHash = bcrypt.hashSync(req.body.password, 10);
  });
  flash(req, 'success', 'המשתמש עודכן');
  res.redirect('/admin/users');
});

// ייבוא משתמשים מהדבקת טבלה (מאקסל): שם מלא, שם משתמש, מייל, מחלקה, תפקיד
router.post('/admin/users/import', (req, res) => {
  const lines = String(req.body.rows || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const password = req.body.password || '';
  if (password.length < 6) { flash(req, 'error', 'יש להגדיר סיסמה ראשונית (לפחות 6 תווים)'); return res.redirect('/admin/users'); }
  let created = 0; const skipped = [];
  mutate(db => {
    lines.forEach(line => {
      const [fullName, username, email, deptName, jobTitle] = line.split(/\t|,/).map(s => (s || '').trim());
      if (!fullName || !username) return skipped.push(line);
      if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return skipped.push(`${username} (קיים)`);
      let dept = db.departments.find(d => d.name === deptName);
      if (!dept && deptName) { dept = { id: nextId(db, 'department'), name: deptName }; db.departments.push(dept); }
      db.users.push({ id: nextId(db, 'user'), fullName, username, email: email || '', jobTitle: jobTitle || '', phone: '', departmentId: dept ? dept.id : null, role: 'user', active: true, passwordHash: bcrypt.hashSync(password, 10) });
      created++;
    });
  });
  flash(req, 'success', `נוצרו ${created} משתמשים`);
  if (skipped.length) flash(req, 'warning', 'דולגו: ' + skipped.join(' | '));
  res.redirect('/admin/users');
});

// --- הגדרות תזכורות ---
router.get('/admin/settings', (req, res) => {
  res.render('admin/settings', { title: 'הגדרות תזכורות', s: settings(), defaults: DEFAULT_SETTINGS, lastRun: q.lastReminderRun ? q.lastReminderRun() : null, smtp: mailer.isConfigured() });
});

router.post('/admin/settings', (req, res) => {
  mutate(db => {
    db.settings = db.settings || {};
    Object.keys(DEFAULT_SETTINGS).forEach(k => {
      if (req.body[k] !== undefined && req.body[k] !== '') db.settings[k] = Math.max(0, Number(req.body[k]) || 0);
    });
    db.settings.reminderHour = Math.min(23, db.settings.reminderHour ?? DEFAULT_SETTINGS.reminderHour);
  });
  flash(req, 'success', 'ההגדרות נשמרו');
  res.redirect('/admin/settings');
});

router.post('/admin/settings/run-now', async (req, res) => {
  const r = await scheduler.runAll();
  flash(req, 'success', `הורצו התזכורות: ${r.tasks} למשימות, ${r.responses} למשתתפים, ${r.owners} סיכומי Owner`);
  res.redirect('/admin/settings');
});

router.post('/admin/settings/test-mail', async (req, res) => {
  const r = await sendMail({ to: req.user.email, subject: 'בדיקת מייל — מערכת ניהול תחקירים', html: layout({ heading: 'בדיקת מייל', paragraphs: ['אם קיבלת הודעה זו — הגדרות המייל תקינות.'] }), text: 'בדיקת מייל' });
  flash(req, r.sent ? 'success' : 'error', r.sent ? `מייל בדיקה נשלח ל-${req.user.email}` : `לא נשלח: ${r.reason}`);
  res.redirect('/admin/settings');
});

// --- מחלקות ---
router.get('/admin/departments', (req, res) => {
  const deps = q.departments().map(d => ({ ...d, userCount: q.users().filter(u => u.departmentId === d.id).length }));
  res.render('admin/departments', { title: 'ניהול מחלקות', deps, users: q.activeUsers() });
});

router.post('/admin/departments', (req, res) => {
  const name = (req.body.name || '').trim();
  if (name && !q.departments().some(d => d.name === name)) {
    mutate(db => db.departments.push({ id: nextId(db, 'department'), name, managerId: Number(req.body.managerId) || null }));
  }
  res.redirect('/admin/departments');
});

router.post('/admin/departments/:id', (req, res) => {
  mutate(db => {
    const d = db.departments.find(x => x.id === Number(req.params.id));
    if (!d) return;
    if (req.body.name) d.name = req.body.name.trim();
    d.managerId = Number(req.body.managerId) || null;
  });
  res.redirect('/admin/departments');
});

router.post('/admin/departments/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (q.users().some(u => u.departmentId === id)) {
    flash(req, 'error', 'לא ניתן למחוק מחלקה שיש בה משתמשים');
  } else {
    mutate(db => { db.departments = db.departments.filter(d => d.id !== id); });
  }
  res.redirect('/admin/departments');
});

module.exports = router;
