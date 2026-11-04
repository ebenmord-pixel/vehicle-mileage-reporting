// מילוי "החלק שלי" בתחקיר — דרך קישור אישי במייל (ללא צורך בהתחברות) או מתוך המערכת.
const express = require('express');
const { q, mutate, log } = require('../db');
const { asArray, flash } = require('../helpers');
const C = require('../constants');

const router = express.Router();

router.get('/respond/:token', (req, res) => {
  const found = q.participantByToken(req.params.token);
  if (!found) return res.status(404).render('error', { title: 'קישור לא תקף', message: 'הקישור אינו תקף או שהוסר. פנו למנהל התחקיר.' });
  const { debrief, participant } = found;
  res.render('respond', {
    title: `התייחסות לתחקיר ${debrief.number}`,
    d: debrief, p: participant,
    respUser: q.user(participant.userId),
    dept: q.department(participant.departmentId),
    fields: C.RESPONSE_FIELDS,
    locked: participant.status === 'submitted' || debrief.status === 'closed'
  });
});

router.post('/respond/:token', (req, res) => {
  const found = q.participantByToken(req.params.token);
  if (!found) return res.status(404).render('error', { title: 'קישור לא תקף', message: 'הקישור אינו תקף' });
  const { debrief, participant } = found;
  if (participant.status === 'submitted' || debrief.status === 'closed') {
    flash(req, 'warning', 'ההתייחסות כבר הוגשה. לתיקון יש לפנות למנהל התחקיר.');
    return res.redirect(`/respond/${req.params.token}`);
  }
  const submit = req.body.action === 'submit';
  const response = {};
  C.RESPONSE_FIELDS.forEach(f => { response[f.key] = (req.body[f.key] || '').trim(); });
  const dates = asArray(req.body.tl_date), times = asArray(req.body.tl_time), descs = asArray(req.body.tl_desc);
  response.timeline = descs.map((desc, i) => ({ date: dates[i] || '', time: times[i] || '', description: String(desc || '').trim() })).filter(t => t.description);

  if (submit) {
    const missing = C.RESPONSE_FIELDS.filter(f => f.required && !response[f.key]);
    if (missing.length) {
      mutate(db => { db.debriefs.find(x => x.id === debrief.id).participants.find(x => x.id === participant.id).response = response; });
      flash(req, 'error', 'נא למלא: ' + missing.map(f => f.label).join(', '));
      return res.redirect(`/respond/${req.params.token}`);
    }
  }

  mutate(db => {
    const d = db.debriefs.find(x => x.id === debrief.id);
    const p = d.participants.find(x => x.id === participant.id);
    p.response = response;
    p.updatedAt = new Date().toISOString();
    if (submit) {
      p.status = 'submitted';
      p.submittedAt = new Date().toISOString();
      log(db, { userId: p.userId, debriefId: d.id, text: 'הגיש/ה את ההתייחסות שלו/ה' });
      // כשכולם הגישו — התחקיר מוכן לישיבה
      if (d.status === 'collecting' && d.participants.every(x => x.status === 'submitted')) {
        d.status = 'ready';
        log(db, { debriefId: d.id, text: 'כל המשתתפים הגישו — התחקיר מוכן לישיבה' });
      }
    } else {
      p.status = 'draft';
    }
  });
  flash(req, 'success', submit ? 'תודה! ההתייחסות שלך הוגשה בהצלחה.' : 'הטיוטה נשמרה. אפשר לחזור ולהשלים בכל עת דרך אותו קישור.');
  res.redirect(`/respond/${req.params.token}`);
});

module.exports = router;
