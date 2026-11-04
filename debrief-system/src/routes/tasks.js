const express = require('express');
const XLSX = require('xlsx');
const { q, mutate, nextId, log } = require('../db');
const { requireLogin, forbidden, notFound } = require('../auth');
const { canManage, canView, canEditTask, isOverdue, daysLeft, backTo, flash, isAdmin, today } = require('../helpers');
const C = require('../constants');
const notify = require('../notifications');

const router = express.Router();
router.use('/tasks', requireLogin);

function clampProgress(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function visibleTasks(user) {
  return q.tasks().filter(t => {
    if (isAdmin(user) || t.assigneeId === user.id || t.createdBy === user.id) return true;
    const d = t.debriefId ? q.debrief(t.debriefId) : null;
    return d ? canView(user, d) : false;
  });
}

function filterTasks(list, query, user) {
  const { mine, status, dept, debrief, assignee, overdue, search } = query;
  if (mine) list = list.filter(t => t.assigneeId === user.id);
  if (status === 'active') list = list.filter(t => !['done', 'cancelled'].includes(t.status));
  else if (status) list = list.filter(t => t.status === status);
  if (dept) list = list.filter(t => (q.user(t.assigneeId) || {}).departmentId === Number(dept) || t.departmentId === Number(dept));
  if (debrief) list = list.filter(t => t.debriefId === Number(debrief));
  if (assignee) list = list.filter(t => t.assigneeId === Number(assignee));
  if (overdue) list = list.filter(isOverdue);
  if (search) { const s = search.toLowerCase(); list = list.filter(t => `${t.title} ${t.description}`.toLowerCase().includes(s)); }
  return list.sort((a, b) => {
    const ao = isOverdue(a) ? 0 : 1, bo = isOverdue(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  });
}

router.get('/tasks', (req, res) => {
  const query = { status: 'active', ...req.query };
  const tasks = filterTasks(visibleTasks(req.user), query, req.user);
  const view = req.query.view === 'board' ? 'board' : 'table';
  res.render('tasks/list', {
    title: 'משימות לשיפור', tasks, filters: query, view,
    departments: q.departments(), users: q.activeUsers(),
    debriefs: q.debriefs().filter(d => canView(req.user, d)), daysLeft
  });
});

router.get('/tasks/export.xlsx', (req, res) => {
  const tasks = filterTasks(visibleTasks(req.user), { ...req.query }, req.user);
  const rows = tasks.map(t => {
    const d = t.debriefId ? q.debrief(t.debriefId) : null;
    const u = q.user(t.assigneeId);
    const lastNote = (t.notes || []).slice(-1)[0];
    return {
      'מס׳': t.id,
      'תחקיר': d ? `${d.number} — ${d.title}` : '',
      'משימה': t.title,
      'פירוט': t.description || '',
      'אחראי': u ? u.fullName : '',
      'מחלקה': u ? (q.department(u.departmentId) || {}).name || '' : '',
      'עדיפות': C.priority(t.priority).label,
      'תאריך יעד': t.dueDate || '',
      'סטטוס': C.taskStatus(t.status).label,
      'התקדמות %': t.progress || 0,
      'באיחור': isOverdue(t) ? 'כן' : '',
      'הערה אחרונה': lastNote ? lastNote.text : ''
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [6, 30, 40, 40, 18, 16, 10, 12, 12, 10, 8, 40].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'משימות');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="tasks-${today()}.xlsx"`);
  res.send(buf);
});

router.get('/tasks/new', (req, res) => {
  const debrief = req.query.debriefId ? q.debrief(req.query.debriefId) : null;
  if (debrief && !canManage(req.user, debrief)) return forbidden(res);
  res.render('tasks/form', {
    title: 'משימה חדשה', task: null, debrief,
    conclusionId: Number(req.query.conclusionId) || null,
    users: q.activeUsers(), departments: q.departments(),
    debriefs: q.debriefs().filter(d => canManage(req.user, d)),
    returnTo: req.query.returnTo || ''
  });
});

function taskFields(body) {
  return {
    title: (body.title || '').trim(),
    description: (body.description || '').trim(),
    assigneeId: Number(body.assigneeId) || null,
    dueDate: body.dueDate || '',
    priority: body.priority || 'medium',
    debriefId: Number(body.debriefId) || null,
    conclusionId: Number(body.conclusionId) || null,
    successCriteria: (body.successCriteria || '').trim(),
    // '' = ברירת מחדל מההגדרות, 0 = ללא תזכורות, n = כל n ימים
    reminderDays: body.reminderDays === undefined || body.reminderDays === '' ? null : Math.max(0, Number(body.reminderDays) || 0)
  };
}

async function createTask(req, fields) {
  const task = mutate(db => {
    const t = {
      id: nextId(db, 'task'), ...fields,
      departmentId: fields.assigneeId ? (q.user(fields.assigneeId) || {}).departmentId || null : null,
      status: 'open', progress: 0, notes: [],
      createdBy: req.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      completedAt: null
    };
    db.tasks.push(t);
    if (t.debriefId) {
      const d = db.debriefs.find(x => x.id === t.debriefId);
      if (d && ['draft', 'collecting', 'ready'].includes(d.status)) d.status = 'followup';
    }
    log(db, { userId: req.user.id, debriefId: t.debriefId, text: `יצר/ה משימה "${t.title}" עבור ${(q.user(t.assigneeId) || {}).fullName || '-'}` });
    return t;
  });
  let mail = null;
  const wantsMail = !req.body.notifyField || req.body.notify === 'on';
  if (fields.assigneeId && wantsMail) mail = await notify.sendTaskAssigned(task);
  return { task, mail };
}

router.post('/tasks', async (req, res) => {
  const fields = taskFields(req.body);
  if (!fields.title || !fields.assigneeId) {
    flash(req, 'error', 'חובה למלא כותרת משימה ואחראי');
    return res.redirect(backTo(req, '/tasks/new'));
  }
  if (fields.debriefId && !canManage(req.user, q.debrief(fields.debriefId))) return forbidden(res);
  const { task, mail } = await createTask(req, fields);
  flash(req, 'success', `המשימה נוצרה${mail ? (mail.sent ? ' ונשלח מייל לאחראי' : ` (המייל לא נשלח: ${mail.reason})`) : ''}`);
  res.redirect(backTo(req, `/tasks/${task.id}`));
});

router.get('/tasks/:id(\\d+)', (req, res) => {
  const t = q.task(req.params.id);
  if (!t) return notFound(res, 'המשימה לא נמצאה');
  const d = t.debriefId ? q.debrief(t.debriefId) : null;
  if (!canEditTask(req.user, t) && !(d && canView(req.user, d))) return forbidden(res);
  res.render('tasks/show', {
    title: t.title, t, d,
    conclusion: d && t.conclusionId ? d.conclusions.find(c => c.id === t.conclusionId) : null,
    canEdit: canEditTask(req.user, t),
    canManageTask: isAdmin(req.user) || t.createdBy === req.user.id || canManage(req.user, d)
  });
});

router.get('/tasks/:id/edit', (req, res) => {
  const t = q.task(req.params.id);
  if (!t) return notFound(res);
  const d = t.debriefId ? q.debrief(t.debriefId) : null;
  if (!(isAdmin(req.user) || t.createdBy === req.user.id || canManage(req.user, d))) return forbidden(res);
  res.render('tasks/form', {
    title: 'עריכת משימה', task: t, debrief: d, conclusionId: t.conclusionId,
    users: q.activeUsers(), departments: q.departments(),
    debriefs: q.debriefs().filter(x => canManage(req.user, x)), returnTo: ''
  });
});

router.post('/tasks/:id(\\d+)', async (req, res) => {
  const t = q.task(req.params.id);
  if (!t) return notFound(res);
  const d = t.debriefId ? q.debrief(t.debriefId) : null;
  if (!(isAdmin(req.user) || t.createdBy === req.user.id || canManage(req.user, d))) return forbidden(res);
  const fields = taskFields(req.body);
  if (!fields.title || !fields.assigneeId) { flash(req, 'error', 'חובה למלא כותרת ואחראי'); return res.redirect(`/tasks/${t.id}/edit`); }
  const reassigned = fields.assigneeId !== t.assigneeId;
  mutate(db => {
    const x = db.tasks.find(y => y.id === t.id);
    const changes = [];
    if (x.dueDate !== fields.dueDate) changes.push(`תאריך יעד: ${x.dueDate || '-'} ← ${fields.dueDate || '-'}`);
    if (reassigned) changes.push(`אחראי: ${(q.user(x.assigneeId) || {}).fullName || '-'} ← ${(q.user(fields.assigneeId) || {}).fullName}`);
    Object.assign(x, fields, { updatedAt: new Date().toISOString() });
    x.departmentId = (q.user(x.assigneeId) || {}).departmentId || null;
    if (changes.length) x.notes.push({ id: nextId(db, 'note'), userId: req.user.id, at: new Date().toISOString(), text: 'עדכון משימה — ' + changes.join(' | '), system: true });
  });
  if (reassigned) await notify.sendTaskAssigned(q.task(t.id));
  flash(req, 'success', 'המשימה עודכנה');
  res.redirect(`/tasks/${t.id}`);
});

// שליחת תזכורת ידנית ל-Owner
router.post('/tasks/:id/remind', async (req, res) => {
  const t = q.task(req.params.id);
  if (!t) return notFound(res);
  if (!canEditTask(req.user, t)) return forbidden(res);
  const r = await notify.sendTaskReminder(t, { manual: true });
  mutate(db => {
    const x = db.tasks.find(y => y.id === t.id);
    x.lastReminderAt = new Date().toISOString();
    x.reminderCount = (x.reminderCount || 0) + 1;
    x.lastReminderResult = r.sent ? 'נשלח' : r.reason;
    x.notes.push({ id: nextId(db, 'note'), userId: req.user.id, at: new Date().toISOString(), text: r.sent ? 'נשלחה תזכורת במייל ל-Owner' : `תזכורת לא נשלחה: ${r.reason}`, system: true });
  });
  flash(req, r.sent ? 'success' : 'warning', r.sent ? 'התזכורת נשלחה' : `התזכורת לא נשלחה: ${r.reason}`);
  res.redirect(backTo(req, `/tasks/${t.id}`));
});

// עדכון התקדמות + הערה (האחראי, יוצר המשימה או מנהל התחקיר)
router.post('/tasks/:id/progress', (req, res) => {
  const t = q.task(req.params.id);
  if (!t) return notFound(res);
  if (!canEditTask(req.user, t)) return forbidden(res);
  mutate(db => {
    const x = db.tasks.find(y => y.id === t.id);
    const prev = { progress: x.progress, status: x.status };
    if (req.body.progress !== undefined && req.body.progress !== '') x.progress = clampProgress(req.body.progress);
    if (req.body.status && C.TASK_STATUSES.some(s => s.key === req.body.status)) x.status = req.body.status;
    if (x.progress === 100 && x.status !== 'cancelled') x.status = 'done';
    else if (x.status === 'open' && x.progress > 0) x.status = 'in_progress';
    if (x.status === 'done') { x.progress = 100; x.completedAt = x.completedAt || new Date().toISOString(); } else x.completedAt = null;
    x.updatedAt = new Date().toISOString();
    const text = (req.body.note || '').trim();
    if (text || prev.progress !== x.progress || prev.status !== x.status) {
      x.notes.push({
        id: nextId(db, 'note'), userId: req.user.id, at: new Date().toISOString(), text,
        progressFrom: prev.progress, progressTo: x.progress,
        statusFrom: prev.status, statusTo: x.status
      });
    }
    if (prev.status !== x.status && x.status === 'done') log(db, { userId: req.user.id, debriefId: x.debriefId, text: `השלים/ה את המשימה "${x.title}"` });
  });
  flash(req, 'success', 'ההתקדמות עודכנה');
  res.redirect(backTo(req, `/tasks/${t.id}`));
});

router.post('/tasks/:id/delete', (req, res) => {
  const t = q.task(req.params.id);
  if (!t) return notFound(res);
  const d = t.debriefId ? q.debrief(t.debriefId) : null;
  if (!(isAdmin(req.user) || t.createdBy === req.user.id || canManage(req.user, d))) return forbidden(res);
  mutate(db => {
    db.tasks = db.tasks.filter(x => x.id !== t.id);
    log(db, { userId: req.user.id, debriefId: t.debriefId, text: `מחק/ה את המשימה "${t.title}"` });
  });
  flash(req, 'success', 'המשימה נמחקה');
  res.redirect(backTo(req, d ? `/debriefs/${d.id}#tasks` : '/tasks'));
});

module.exports = router;
