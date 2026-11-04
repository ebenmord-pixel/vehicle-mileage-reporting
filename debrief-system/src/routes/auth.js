const express = require('express');
const bcrypt = require('bcryptjs');
const { q, mutate } = require('../db');
const { requireLogin } = require('../auth');
const { flash } = require('../helpers');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'התחברות', error: null, next: req.query.next || '' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = q.userByUsername(username);
  const next = typeof req.body.next === 'string' && req.body.next.startsWith('/') && !req.body.next.startsWith('//') ? req.body.next : '/';
  if (!user || user.active === false || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.render('login', { title: 'התחברות', error: 'שם משתמש או סיסמה שגויים', next });
  }
  req.session.regenerate(() => {
    req.session.userId = user.id;
    res.redirect(next);
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/profile', requireLogin, (req, res) => {
  res.render('profile', { title: 'הפרופיל שלי' });
});

router.post('/profile', requireLogin, (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  if (newPassword) {
    if (!bcrypt.compareSync(currentPassword || '', req.user.passwordHash)) {
      flash(req, 'error', 'הסיסמה הנוכחית שגויה');
      return res.redirect('/profile');
    }
    if (newPassword.length < 6) {
      flash(req, 'error', 'הסיסמה החדשה חייבת להכיל לפחות 6 תווים');
      return res.redirect('/profile');
    }
  }
  mutate(db => {
    const u = db.users.find(x => x.id === req.user.id);
    u.email = (email || '').trim();
    if (newPassword) u.passwordHash = bcrypt.hashSync(newPassword, 10);
  });
  flash(req, 'success', 'הפרטים עודכנו');
  res.redirect('/profile');
});

module.exports = router;
