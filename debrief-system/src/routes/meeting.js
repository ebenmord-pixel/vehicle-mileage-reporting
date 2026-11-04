// מצב ישיבה: הצגת התחקיר כמצגת + עריכה חיה של ממצאים/מסקנות/משימות, ייצוא PowerPoint והדפסה.
const express = require('express');
const { q, mutate, log } = require('../db');
const { requireLogin, forbidden, notFound } = require('../auth');
const { asArray, canManage, canView, flash } = require('../helpers');
const { buildSlides, presentationData } = require('../slides');
const { buildPptx } = require('../pptx');
const notify = require('../notifications');
const C = require('../constants');

const router = express.Router();
router.use('/debriefs', requireLogin);

function load(req, res, manage) {
  const d = q.debrief(req.params.id);
  if (!d) { notFound(res); return null; }
  if (manage ? !canManage(req.user, d) : !canView(req.user, d)) { forbidden(res); return null; }
  return d;
}

// מיזוג ציר זמן ראשי + צירי הזמן שהמשתתפים הוסיפו
function mergedTimeline(d) {
  const items = d.timeline.map(t => ({ ...t, source: null }));
  d.participants.filter(p => p.status === 'submitted').forEach(p => {
    (p.response.timeline || []).forEach(t => items.push({ ...t, source: (q.department(p.departmentId) || {}).name || (q.user(p.userId) || {}).fullName }));
  });
  return items.sort((a, b) => `${a.date || d.eventDate || ''} ${a.time || ''}`.localeCompare(`${b.date || d.eventDate || ''} ${b.time || ''}`));
}

router.get('/debriefs/:id/present', (req, res) => {
  const d = load(req, res, false); if (!d) return;
  const data = presentationData(d);
  res.render('present', {
    title: `מצגת — ${d.title}`, layoutless: true,
    ...data, slides: buildSlides(d), timeline: mergedTimeline(d),
    manage: canManage(req.user, d), fields: C.RESPONSE_FIELDS,
    users: q.activeUsers(), departments: q.departments(),
    startSlide: Number(req.query.slide) || 0
  });
});

router.get('/debriefs/:id/print', (req, res) => {
  const d = load(req, res, false); if (!d) return;
  res.render('print', { title: `${d.number} — ${d.title}`, ...presentationData(d), slides: buildSlides(d), timeline: mergedTimeline(d), fields: C.RESPONSE_FIELDS });
});

router.get('/debriefs/:id/export.pptx', async (req, res, next) => {
  const d = load(req, res, false); if (!d) return;
  try {
    const buf = await buildPptx(d, { timeline: mergedTimeline(d) });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="debrief-${d.number}.pptx"; filename*=UTF-8''${encodeURIComponent(`תחקיר ${d.number}.pptx`)}`);
    res.send(buf);
  } catch (err) { next(err); }
});

// פרטי ישיבה (מועד, מיקום, משתתפים, סיכום ישיבה)
router.post('/debriefs/:id/meeting', async (req, res) => {
  const d = load(req, res, true); if (!d) return;
  const attendees = asArray(req.body.attendees).map(Number).filter(Boolean);
  mutate(db => {
    const x = db.debriefs.find(y => y.id === d.id);
    x.meeting = {
      ...x.meeting,
      date: req.body.date ?? x.meeting.date,
      time: req.body.time ?? x.meeting.time,
      location: req.body.location ?? x.meeting.location,
      attendees: req.body.attendeesSubmitted ? attendees : x.meeting.attendees,
      notes: req.body.notes ?? x.meeting.notes
    };
    log(db, { userId: req.user.id, debriefId: d.id, text: 'עדכן/ה את פרטי ישיבת התחקיר' });
  });
  if (req.body.sendInvite === 'on') {
    const fresh = q.debrief(d.id);
    let sent = 0, failed = 0;
    for (const uid of fresh.meeting.attendees) {
      const u = q.user(uid); if (!u) continue;
      const r = await notify.sendMeetingInvite(fresh, u);
      r.sent ? sent++ : failed++;
    }
    flash(req, failed ? 'warning' : 'success', `נשלחו ${sent} זימונים${failed ? `, ${failed} לא נשלחו` : ''}`);
  } else {
    flash(req, 'success', 'פרטי הישיבה נשמרו');
  }
  const r = req.body.returnTo;
  res.redirect(typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : `/debriefs/${d.id}#meeting`);
});

// התחלת ישיבה: שינוי סטטוס ומעבר למצגת
router.post('/debriefs/:id/start-meeting', (req, res) => {
  const d = load(req, res, true); if (!d) return;
  mutate(db => {
    const x = db.debriefs.find(y => y.id === d.id);
    if (['draft', 'collecting', 'ready'].includes(x.status)) x.status = 'meeting';
    if (!x.meeting.date) x.meeting.date = new Date().toISOString().slice(0, 10);
    log(db, { userId: req.user.id, debriefId: d.id, text: 'התחיל/ה ישיבת תחקיר' });
  });
  res.redirect(`/debriefs/${d.id}/present`);
});

module.exports = router;
