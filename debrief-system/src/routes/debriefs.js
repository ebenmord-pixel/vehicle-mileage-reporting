const express = require('express');
const { q, mutate, nextId, log, newToken } = require('../db');
const { requireLogin, forbidden, notFound } = require('../auth');
const { asArray, canManage, canView, backTo, flash, isAdmin } = require('../helpers');
const C = require('../constants');
const notify = require('../notifications');

const router = express.Router();
router.use('/debriefs', requireLogin);

function loadDebrief(req, res, { manage = false } = {}) {
  const d = q.debrief(req.params.id);
  if (!d) { notFound(res, 'התחקיר לא נמצא'); return null; }
  if (manage ? !canManage(req.user, d) : !canView(req.user, d)) { forbidden(res); return null; }
  return d;
}

function parseTimeline(body) {
  const dates = asArray(body.tl_date), times = asArray(body.tl_time), descs = asArray(body.tl_desc);
  const items = [];
  descs.forEach((desc, i) => {
    if (!String(desc || '').trim()) return;
    items.push({ date: dates[i] || '', time: times[i] || '', description: String(desc).trim() });
  });
  return items;
}

function detailsFromBody(body) {
  return {
    title: (body.title || '').trim(),
    eventDate: body.eventDate || '',
    eventTime: body.eventTime || '',
    location: (body.location || '').trim(),
    category: body.category || '',
    severity: body.severity || 'medium',
    leadDepartmentId: Number(body.leadDepartmentId) || null,
    facilitatorId: Number(body.facilitatorId) || null,
    summary: (body.summary || '').trim(),
    impact: (body.impact || '').trim(),
    immediateActions: (body.immediateActions || '').trim(),
    responseDueDate: body.responseDueDate || '',
    reminderDays: body.reminderDays === undefined || body.reminderDays === '' ? null : Math.max(0, Number(body.reminderDays) || 0)
  };
}

function nextNumber(db) {
  const year = new Date().getFullYear();
  const count = db.debriefs.filter(d => String(d.number || '').startsWith(year + '-')).length + 1;
  return `${year}-${String(count).padStart(3, '0')}`;
}

// --- רשימה ---
router.get('/debriefs', (req, res) => {
  const { status, severity, dept, search } = req.query;
  let list = q.debriefs().filter(d => canView(req.user, d));
  if (status) list = list.filter(d => d.status === status);
  if (severity) list = list.filter(d => d.severity === severity);
  if (dept) list = list.filter(d => d.leadDepartmentId === Number(dept) || d.participants.some(p => p.departmentId === Number(dept)));
  if (search) {
    const s = search.toLowerCase();
    list = list.filter(d => [d.title, d.summary, d.number, d.location].join(' ').toLowerCase().includes(s));
  }
  const rows = list.map(d => {
    const tasks = q.tasksForDebrief(d.id);
    const submitted = d.participants.filter(p => p.status === 'submitted').length;
    return { d, tasks, submitted, total: d.participants.length, doneTasks: tasks.filter(t => t.status === 'done').length };
  });
  res.render('debriefs/list', { title: 'תחקירים', rows, filters: req.query, departments: q.departments() });
});

// --- יצירה: שלב 1 — מה קרה ---
router.get('/debriefs/new', (req, res) => {
  res.render('debriefs/form', {
    title: 'תחקיר חדש', debrief: null,
    departments: q.departments(), users: q.activeUsers()
  });
});

router.post('/debriefs', (req, res) => {
  const details = detailsFromBody(req.body);
  if (!details.title || !details.summary) {
    flash(req, 'error', 'חובה למלא כותרת ותיאור "מה קרה"');
    return res.redirect('/debriefs/new');
  }
  const debrief = mutate(db => {
    const d = {
      id: nextId(db, 'debrief'),
      number: nextNumber(db),
      ...details,
      timeline: parseTimeline(req.body),
      status: 'draft',
      createdBy: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      participants: [],
      attachments: [],
      findings: [],
      conclusions: [],
      meeting: { date: '', time: '', location: '', attendees: [], notes: '', decisions: '' },
      closingSummary: ''
    };
    if (!d.facilitatorId) d.facilitatorId = req.user.id;
    db.debriefs.push(d);
    log(db, { userId: req.user.id, debriefId: d.id, text: 'פתח/ה את התחקיר' });
    return d;
  });
  flash(req, 'success', `התחקיר ${debrief.number} נוצר. השלב הבא: הקצאת משתתפים רלוונטיים לפי מחלקות.`);
  res.redirect(`/debriefs/${debrief.id}#participants`);
});

// --- צפייה ---
router.get('/debriefs/:id', (req, res) => {
  const d = loadDebrief(req, res); if (!d) return;
  const tasks = q.tasksForDebrief(d.id);
  const myParticipation = d.participants.find(p => p.userId === req.user.id);
  const usersByDept = q.departments().map(dep => ({ dep, users: q.activeUsers().filter(u => u.departmentId === dep.id) }));
  const noDeptUsers = q.activeUsers().filter(u => !q.department(u.departmentId));
  res.render('debriefs/show', {
    title: `${d.number} — ${d.title}`, d, tasks, myParticipation,
    manage: canManage(req.user, d),
    usersByDept, noDeptUsers,
    departments: q.departments(), users: q.activeUsers(),
    activity: q.activityForDebrief(d.id).slice(0, 50)
  });
});

router.get('/debriefs/:id/edit', (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  res.render('debriefs/form', { title: 'עריכת תחקיר', debrief: d, departments: q.departments(), users: q.activeUsers() });
});

router.post('/debriefs/:id', (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  const details = detailsFromBody(req.body);
  if (!details.title || !details.summary) {
    flash(req, 'error', 'חובה למלא כותרת ותיאור "מה קרה"');
    return res.redirect(`/debriefs/${d.id}/edit`);
  }
  mutate(db => {
    const x = db.debriefs.find(y => y.id === d.id);
    Object.assign(x, details, { timeline: parseTimeline(req.body), updatedAt: new Date().toISOString() });
    if (!x.facilitatorId) x.facilitatorId = x.createdBy;
    log(db, { userId: req.user.id, debriefId: d.id, text: 'עדכן/ה את פרטי התחקיר' });
  });
  flash(req, 'success', 'פרטי התחקיר נשמרו');
  res.redirect(backTo(req, `/debriefs/${d.id}`));
});

router.post('/debriefs/:id/status', (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  const status = req.body.status;
  if (!C.DEBRIEF_STATUSES.some(s => s.key === status)) return res.redirect(`/debriefs/${d.id}`);
  mutate(db => {
    const x = db.debriefs.find(y => y.id === d.id);
    x.status = status;
    if (status === 'closed') x.closedAt = new Date().toISOString();
    log(db, { userId: req.user.id, debriefId: d.id, text: `שינה/תה סטטוס ל"${C.debriefStatus(status).label}"` });
  });
  res.redirect(backTo(req, `/debriefs/${d.id}`));
});

router.post('/debriefs/:id/delete', (req, res) => {
  const d = q.debrief(req.params.id);
  if (!d) return notFound(res);
  if (!isAdmin(req.user) && d.createdBy !== req.user.id) return forbidden(res);
  mutate(db => {
    db.debriefs = db.debriefs.filter(x => x.id !== d.id);
    db.tasks = db.tasks.filter(t => t.debriefId !== d.id);
    log(db, { userId: req.user.id, text: `מחק/ה את התחקיר ${d.number} — ${d.title}` });
  });
  flash(req, 'success', 'התחקיר נמחק');
  res.redirect('/debriefs');
});

// --- הקצאת משתתפים לפי מחלקות ---
router.post('/debriefs/:id/participants', async (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  // ערכים בפורמט userId:departmentId
  const picks = asArray(req.body.picks).map(v => {
    const [userId, departmentId] = String(v).split(':').map(Number);
    return { userId, departmentId };
  }).filter(p => q.user(p.userId));
  const request = (req.body.request || '').trim();
  const sendEmail = req.body.sendEmail === 'on';
  if (!picks.length) {
    flash(req, 'error', 'לא נבחרו משתמשים');
    return res.redirect(`/debriefs/${d.id}#participants`);
  }
  const added = mutate(db => {
    const x = db.debriefs.find(y => y.id === d.id);
    const list = [];
    picks.forEach(p => {
      if (x.participants.some(e => e.userId === p.userId)) return;
      const participant = {
        id: nextId(db, 'participant'),
        userId: p.userId,
        departmentId: p.departmentId || q.user(p.userId).departmentId,
        request,
        token: newToken(),
        status: 'pending',
        response: {},
        addedBy: req.user.id,
        addedAt: new Date().toISOString(),
        invitedAt: null,
        submittedAt: null
      };
      x.participants.push(participant);
      list.push(participant);
    });
    if (x.status === 'draft' && list.length) x.status = 'collecting';
    if (list.length) log(db, { userId: req.user.id, debriefId: d.id, text: `הקצה/תה ${list.length} משתתפים: ${list.map(p => q.user(p.userId).fullName).join(', ')}` });
    return list;
  });

  let sent = 0; const failures = [];
  if (sendEmail) {
    for (const p of added) {
      const r = await notify.sendParticipantInvite(q.debrief(d.id), p);
      if (r.sent) sent++; else failures.push(`${q.user(p.userId).fullName}: ${r.reason}`);
      mutate(db => {
        const pp = db.debriefs.find(y => y.id === d.id).participants.find(z => z.id === p.id);
        pp.invitedAt = new Date().toISOString();
        pp.lastEmailResult = r.sent ? 'נשלח' : r.reason;
      });
    }
  }
  flash(req, 'success', `נוספו ${added.length} משתתפים${sendEmail ? `, נשלחו ${sent} מיילים` : ''}`);
  if (failures.length) flash(req, 'warning', 'לא נשלח מייל: ' + failures.join(' | '));
  res.redirect(`/debriefs/${d.id}#participants`);
});

router.post('/debriefs/:id/participants/:pid/remind', async (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  const p = d.participants.find(x => x.id === Number(req.params.pid));
  if (!p) return notFound(res);
  const r = await notify.sendParticipantInvite(d, p, { reminder: Boolean(p.invitedAt) });
  mutate(db => {
    const pp = db.debriefs.find(y => y.id === d.id).participants.find(z => z.id === p.id);
    pp.invitedAt = new Date().toISOString();
    pp.lastEmailResult = r.sent ? 'נשלח' : r.reason;
    log(db, { userId: req.user.id, debriefId: d.id, text: `שלח/ה ${p.invitedAt ? 'תזכורת' : 'הזמנה'} ל${q.user(p.userId).fullName}` });
  });
  flash(req, r.sent ? 'success' : 'warning', r.sent ? 'המייל נשלח' : `המייל לא נשלח: ${r.reason}`);
  res.redirect(`/debriefs/${d.id}#participants`);
});

router.post('/debriefs/:id/remind-pending', async (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  let sent = 0, failed = 0;
  for (const p of d.participants.filter(x => x.status !== 'submitted')) {
    const r = await notify.sendParticipantInvite(d, p, { reminder: true });
    r.sent ? sent++ : failed++;
    mutate(db => {
      const pp = db.debriefs.find(y => y.id === d.id).participants.find(z => z.id === p.id);
      pp.invitedAt = new Date().toISOString();
      pp.lastEmailResult = r.sent ? 'נשלח' : r.reason;
    });
  }
  mutate(db => log(db, { userId: req.user.id, debriefId: d.id, text: `שלח/ה תזכורות לכל מי שטרם מילא (${sent} נשלחו)` }));
  flash(req, failed ? 'warning' : 'success', `נשלחו ${sent} תזכורות${failed ? `, ${failed} לא נשלחו (בדקו הגדרות מייל / כתובות)` : ''}`);
  res.redirect(`/debriefs/${d.id}#participants`);
});

router.post('/debriefs/:id/participants/:pid/delete', (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  mutate(db => {
    const x = db.debriefs.find(y => y.id === d.id);
    const p = x.participants.find(z => z.id === Number(req.params.pid));
    x.participants = x.participants.filter(z => z.id !== Number(req.params.pid));
    if (p) log(db, { userId: req.user.id, debriefId: d.id, text: `הסיר/ה את ${q.user(p.userId)?.fullName} מהתחקיר` });
  });
  res.redirect(`/debriefs/${d.id}#participants`);
});

// פתיחה מחדש של התייחסות שהוגשה (כדי שהמשתתף יוכל לתקן)
router.post('/debriefs/:id/participants/:pid/reopen', (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  mutate(db => {
    const p = db.debriefs.find(y => y.id === d.id).participants.find(z => z.id === Number(req.params.pid));
    if (p) { p.status = 'draft'; log(db, { userId: req.user.id, debriefId: d.id, text: `פתח/ה מחדש לעריכה את ההתייחסות של ${q.user(p.userId)?.fullName}` }); }
  });
  res.redirect(`/debriefs/${d.id}#participants`);
});

// --- ממצאים ומסקנות (נגיש גם ממצב ישיבה) ---
function itemRoutes(kind, label) {
  router.post(`/debriefs/:id/${kind}`, (req, res) => {
    const d = loadDebrief(req, res, { manage: true }); if (!d) return;
    const text = (req.body.text || '').trim();
    if (!text) return res.redirect(backTo(req, `/debriefs/${d.id}#${kind}`));
    mutate(db => {
      const x = db.debriefs.find(y => y.id === d.id);
      const item = { id: nextId(db, 'item'), text, createdBy: req.user.id, createdAt: new Date().toISOString() };
      if (kind === 'findings') {
        item.type = req.body.type || 'negative';
        item.rootCause = req.body.rootCause || '';
        item.departmentId = Number(req.body.departmentId) || null;
      } else {
        item.findingId = Number(req.body.findingId) || null;
      }
      x[kind].push(item);
      log(db, { userId: req.user.id, debriefId: d.id, text: `הוסיף/ה ${label}: ${text.slice(0, 80)}` });
    });
    res.redirect(backTo(req, `/debriefs/${d.id}#${kind}`));
  });

  router.post(`/debriefs/:id/${kind}/:itemId`, (req, res) => {
    const d = loadDebrief(req, res, { manage: true }); if (!d) return;
    mutate(db => {
      const item = db.debriefs.find(y => y.id === d.id)[kind].find(i => i.id === Number(req.params.itemId));
      if (!item) return;
      if (req.body.text !== undefined) item.text = req.body.text.trim();
      if (kind === 'findings') {
        if (req.body.type !== undefined) item.type = req.body.type;
        if (req.body.rootCause !== undefined) item.rootCause = req.body.rootCause;
        if (req.body.departmentId !== undefined) item.departmentId = Number(req.body.departmentId) || null;
      } else if (req.body.findingId !== undefined) {
        item.findingId = Number(req.body.findingId) || null;
      }
    });
    res.redirect(backTo(req, `/debriefs/${d.id}#${kind}`));
  });

  router.post(`/debriefs/:id/${kind}/:itemId/delete`, (req, res) => {
    const d = loadDebrief(req, res, { manage: true }); if (!d) return;
    mutate(db => {
      const x = db.debriefs.find(y => y.id === d.id);
      x[kind] = x[kind].filter(i => i.id !== Number(req.params.itemId));
    });
    res.redirect(backTo(req, `/debriefs/${d.id}#${kind}`));
  });

  // שינוי סדר
  router.post(`/debriefs/:id/${kind}/:itemId/move`, (req, res) => {
    const d = loadDebrief(req, res, { manage: true }); if (!d) return;
    mutate(db => {
      const arr = db.debriefs.find(y => y.id === d.id)[kind];
      const i = arr.findIndex(it => it.id === Number(req.params.itemId));
      const j = req.body.dir === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]];
    });
    res.redirect(backTo(req, `/debriefs/${d.id}#${kind}`));
  });
}
itemRoutes('findings', 'ממצא');
itemRoutes('conclusions', 'מסקנה');

router.post('/debriefs/:id/closing', (req, res) => {
  const d = loadDebrief(req, res, { manage: true }); if (!d) return;
  mutate(db => { db.debriefs.find(y => y.id === d.id).closingSummary = (req.body.closingSummary || '').trim(); });
  res.redirect(backTo(req, `/debriefs/${d.id}`));
});

module.exports = router;
