// טבלת מעקב שיפורים — כל התחקירים בטבלה אחת עם מצב יישום המשימות שנגזרו מהם.
const express = require('express');
const XLSX = require('xlsx');
const { q } = require('../db');
const { requireLogin } = require('../auth');
const { canView, isOverdue, today } = require('../helpers');
const C = require('../constants');
const { fmtDate } = require('../notifications');

const router = express.Router();

function trackingRows(user, query) {
  let list = q.debriefs().filter(d => canView(user, d));
  const { status, severity, dept, health, search, year } = query;
  if (status === 'open') list = list.filter(d => d.status !== 'closed');
  else if (status) list = list.filter(d => d.status === status);
  if (severity) list = list.filter(d => d.severity === severity);
  if (dept) list = list.filter(d => d.leadDepartmentId === Number(dept) || d.participants.some(p => p.departmentId === Number(dept)));
  if (year) list = list.filter(d => String(d.eventDate || '').startsWith(year));
  if (search) { const s = search.toLowerCase(); list = list.filter(d => `${d.number} ${d.title} ${d.summary}`.toLowerCase().includes(s)); }

  let rows = list.map(d => {
    const tasks = q.tasksForDebrief(d.id).filter(t => t.status !== 'cancelled')
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    const open = tasks.filter(t => t.status !== 'done');
    const overdue = open.filter(isOverdue);
    const progress = tasks.length ? Math.round(tasks.reduce((s, t) => s + (t.progress || 0), 0) / tasks.length) : 0;
    const nextDue = open.filter(t => t.dueDate).map(t => t.dueDate).sort()[0] || '';
    const submitted = d.participants.filter(p => p.status === 'submitted').length;
    // מצב בריאות: אדום = יש באיחור, צהוב = אין משימות אחרי ישיבה / יעד השבוע, ירוק = תקין/הושלם
    let healthKey = 'green';
    if (overdue.length) healthKey = 'red';
    else if ((['meeting', 'followup'].includes(d.status) && !tasks.length) || (nextDue && nextDue <= addDays(7))) healthKey = 'yellow';
    return { d, tasks, open, overdue, progress, nextDue, submitted, healthKey, lastUpdate: lastUpdate(d, tasks) };
  });
  if (health) rows = rows.filter(r => r.healthKey === health);
  return rows;
}

function addDays(n) {
  const x = new Date(today()); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10);
}

function lastUpdate(d, tasks) {
  const dates = [d.updatedAt, ...tasks.map(t => t.updatedAt)].filter(Boolean).sort();
  return dates[dates.length - 1] || d.createdAt;
}

router.get('/tracking', requireLogin, (req, res) => {
  const query = { status: 'open', ...req.query };
  const rows = trackingRows(req.user, query);
  const totals = {
    debriefs: rows.length,
    tasks: rows.reduce((s, r) => s + r.tasks.length, 0),
    open: rows.reduce((s, r) => s + r.open.length, 0),
    overdue: rows.reduce((s, r) => s + r.overdue.length, 0),
    progress: rows.length ? Math.round(rows.reduce((s, r) => s + r.progress, 0) / rows.length) : 0
  };
  const years = [...new Set(q.debriefs().map(d => String(d.eventDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  res.render('tracking', { title: 'טבלת מעקב שיפורים', rows, totals, filters: query, departments: q.departments(), years });
});

router.get('/tracking/export.xlsx', requireLogin, (req, res) => {
  const rows = trackingRows(req.user, { ...req.query });
  const data = [];
  rows.forEach(r => {
    const base = {
      'מס׳ תחקיר': r.d.number, 'כותרת': r.d.title, 'תאריך אירוע': fmtDate(r.d.eventDate),
      'חומרה': C.severity(r.d.severity).label, 'מחלקה מובילה': (q.department(r.d.leadDepartmentId) || {}).name || '',
      'סטטוס תחקיר': C.debriefStatus(r.d.status).label, 'התקדמות תחקיר %': r.progress
    };
    if (!r.tasks.length) data.push({ ...base, 'משימה': '', 'אחראי': '', 'תאריך יעד': '', 'סטטוס משימה': '', 'התקדמות משימה %': '', 'באיחור': '' });
    r.tasks.forEach(t => data.push({
      ...base, 'משימה': t.title, 'אחראי': (q.user(t.assigneeId) || {}).fullName || '',
      'תאריך יעד': fmtDate(t.dueDate), 'סטטוס משימה': C.taskStatus(t.status).label,
      'התקדמות משימה %': t.progress || 0, 'באיחור': isOverdue(t) ? 'כן' : ''
    }));
  });
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [10, 30, 12, 10, 16, 16, 10, 40, 18, 12, 12, 10, 8].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'מעקב שיפורים');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="improvement-tracking-${today()}.xlsx"`);
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

module.exports = router;
