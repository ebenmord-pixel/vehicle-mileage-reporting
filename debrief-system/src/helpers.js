const { q } = require('./db');
const C = require('./constants');
const { fmtDate } = require('./notifications');

function asArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(task) {
  return task.dueDate && !['done', 'cancelled'].includes(task.status) && task.dueDate < today();
}

function daysLeft(task) {
  if (!task.dueDate) return null;
  return Math.round((new Date(task.dueDate) - new Date(today())) / 86400000);
}

// הרשאות
function isAdmin(user) { return user && user.role === 'admin'; }

function canManage(user, debrief) {
  if (!user || !debrief) return false;
  return isAdmin(user) || debrief.createdBy === user.id || debrief.facilitatorId === user.id;
}

function canView(user, debrief) {
  if (canManage(user, debrief)) return true;
  if (!user) return false;
  if (debrief.participants.some(p => p.userId === user.id)) return true;
  if ((debrief.meeting?.attendees || []).includes(user.id)) return true;
  return q.tasksForDebrief(debrief.id).some(t => t.assigneeId === user.id);
}

function canEditTask(user, task) {
  if (!user || !task) return false;
  if (isAdmin(user) || task.assigneeId === user.id || task.createdBy === user.id) return true;
  const d = task.debriefId ? q.debrief(task.debriefId) : null;
  return canManage(user, d);
}

// חזרה לכתובת שנשלחה בטופס (רק נתיב פנימי)
function backTo(req, fallback) {
  const r = req.body?.returnTo || req.query?.returnTo;
  if (r && typeof r === 'string' && r.startsWith('/') && !r.startsWith('//')) return r;
  return fallback;
}

function flash(req, type, text) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, text });
}

// משתנים זמינים בכל התבניות
function viewLocals() {
  return {
    C, fmtDate, isOverdue, daysLeft, today,
    userName: id => (q.user(id) || {}).fullName || '-',
    deptName: id => (q.department(id) || {}).name || '-',
    fmtDateTime: iso => {
      if (!iso) return '-';
      const d = new Date(iso);
      return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    nl2br: s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\n/g, '<br>')
  };
}

module.exports = { asArray, today, isOverdue, daysLeft, isAdmin, canManage, canView, canEditTask, backTo, flash, viewLocals };
