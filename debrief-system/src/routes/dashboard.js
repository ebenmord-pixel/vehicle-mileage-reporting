const express = require('express');
const { q } = require('../db');
const { requireLogin } = require('../auth');
const { canView, isOverdue, daysLeft } = require('../helpers');
const C = require('../constants');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const me = req.user;
  const debriefs = q.debriefs().filter(d => canView(me, d));
  const tasks = q.tasks();
  const visibleTasks = tasks.filter(t => !t.debriefId || debriefs.some(d => d.id === t.debriefId) || t.assigneeId === me.id);

  const myPending = [];
  q.debriefs().forEach(d => d.participants.forEach(p => {
    if (p.userId === me.id && p.status !== 'submitted' && d.status !== 'closed') myPending.push({ d, p });
  }));

  const myTasks = tasks.filter(t => t.assigneeId === me.id && !['done', 'cancelled'].includes(t.status))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

  const openTasks = visibleTasks.filter(t => !['done', 'cancelled'].includes(t.status));
  const stats = {
    openDebriefs: debriefs.filter(d => d.status !== 'closed').length,
    awaitingMeeting: debriefs.filter(d => d.status === 'ready').length,
    openTasks: openTasks.length,
    overdue: openTasks.filter(isOverdue).length,
    doneTasks: visibleTasks.filter(t => t.status === 'done').length,
    avgProgress: openTasks.length ? Math.round(openTasks.reduce((s, t) => s + (t.progress || 0), 0) / openTasks.length) : 0
  };

  // התפלגויות לגרפים קטנים
  const byStatus = C.DEBRIEF_STATUSES.map(s => ({ ...s, count: debriefs.filter(d => d.status === s.key).length }));
  const bySeverity = C.SEVERITIES.map(s => ({ ...s, count: debriefs.filter(d => d.severity === s.key).length }));
  const rootCauses = {};
  debriefs.forEach(d => d.findings.forEach(f => { if (f.rootCause) rootCauses[f.rootCause] = (rootCauses[f.rootCause] || 0) + 1; }));
  const rootCauseList = Object.entries(rootCauses).sort((a, b) => b[1] - a[1]);

  const deptLoad = q.departments().map(dep => {
    const t = openTasks.filter(x => (q.user(x.assigneeId) || {}).departmentId === dep.id);
    return { dep, open: t.length, overdue: t.filter(isOverdue).length };
  }).filter(x => x.open);

  res.render('dashboard', {
    title: 'לוח בקרה', stats, myPending, myTasks, byStatus, bySeverity, rootCauseList, deptLoad,
    recent: debriefs.slice(0, 6), daysLeft
  });
});

module.exports = router;
