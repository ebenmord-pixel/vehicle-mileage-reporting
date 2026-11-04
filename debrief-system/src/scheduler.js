// תזכורות אוטומטיות במייל — רצות פעם ביום ושולחות לפי "כל X ימים":
//  1. Owner של משימה פתוחה — כל taskReminderDays ימים (או לפי הגדרה ייחודית למשימה); באיחור — כל overdueReminderDays.
//  2. משתתף שטרם מילא את חלקו — כל responseReminderDays ימים (או לפי הגדרת התחקיר).
//  3. Owner התחקיר — סיכום משימות באיחור וממתינים, כל ownerDigestDays ימים.
const cron = require('node-cron');
const { q, mutate, settings } = require('./db');
const { isOverdue } = require('./helpers');
const notify = require('./notifications');

const DAY = 86400000;

function due(lastIso, everyDays, now = Date.now()) {
  if (!everyDays || everyDays <= 0) return false;
  if (!lastIso) return true;
  // סובלנות של שעה כדי שהרצה יומית לא "תפספס" יום
  return now - new Date(lastIso).getTime() >= everyDays * DAY - 3600000;
}

// מחזיר את תדירות התזכורת האפקטיבית למשימה
function taskInterval(task, s = settings()) {
  if (task.reminderDays === 0) return 0; // כבוי במפורש
  const base = task.reminderDays || s.taskReminderDays;
  return isOverdue(task) && s.overdueReminderDays ? Math.min(base || Infinity, s.overdueReminderDays) : base;
}

async function runTaskReminders() {
  const s = settings();
  let sent = 0;
  for (const t of q.tasks().filter(x => !['done', 'cancelled'].includes(x.status) && x.assigneeId)) {
    const u = q.user(t.assigneeId);
    if (!u || u.active === false || !u.email) continue;
    // ספירת הימים מתחילה ממועד ההקצאה
    if (!due(t.lastReminderAt || t.createdAt, taskInterval(t, s))) continue;
    const r = await notify.sendTaskReminder(t);
    mutate(db => {
      const x = db.tasks.find(y => y.id === t.id);
      x.lastReminderAt = new Date().toISOString();
      x.reminderCount = (x.reminderCount || 0) + 1;
      x.lastReminderResult = r.sent ? 'נשלח' : r.reason;
    });
    if (r.sent) sent++;
  }
  return sent;
}

async function runResponseReminders() {
  const s = settings();
  let sent = 0;
  for (const d of q.debriefs().filter(x => x.status === 'collecting' || x.status === 'ready')) {
    const every = d.reminderDays === 0 ? 0 : (d.reminderDays || s.responseReminderDays);
    for (const p of d.participants.filter(x => x.status !== 'submitted')) {
      if (!due(p.invitedAt || p.addedAt, every)) continue;
      const r = await notify.sendParticipantInvite(d, p, { reminder: Boolean(p.invitedAt) });
      mutate(db => {
        const pp = db.debriefs.find(y => y.id === d.id).participants.find(z => z.id === p.id);
        pp.invitedAt = new Date().toISOString();
        pp.lastEmailResult = r.sent ? 'נשלח (תזכורת אוטומטית)' : r.reason;
      });
      if (r.sent) sent++;
    }
  }
  return sent;
}

async function runOwnerDigests() {
  const s = settings();
  if (!s.ownerDigestDays) return 0;
  const byOwner = {};
  q.debriefs().filter(d => d.status !== 'closed').forEach(d => {
    const ownerId = d.facilitatorId || d.createdBy;
    const overdue = q.tasksForDebrief(d.id).filter(isOverdue);
    const pending = ['collecting', 'ready'].includes(d.status) ? d.participants.filter(p => p.status !== 'submitted') : [];
    if (!overdue.length && !pending.length) return;
    (byOwner[ownerId] = byOwner[ownerId] || []).push({ debrief: d, overdue, pending });
  });
  let sent = 0;
  for (const [ownerId, items] of Object.entries(byOwner)) {
    const owner = q.user(ownerId);
    if (!owner || !owner.email || owner.active === false) continue;
    if (!due(owner.lastDigestAt, s.ownerDigestDays)) continue;
    const r = await notify.sendOwnerDigest(owner, items);
    mutate(db => { db.users.find(u => u.id === owner.id).lastDigestAt = new Date().toISOString(); });
    if (r.sent) sent++;
  }
  return sent;
}

async function runAll() {
  const a = await runTaskReminders();
  const b = await runResponseReminders();
  const c = await runOwnerDigests();
  const summary = { tasks: a, responses: b, owners: c, at: new Date().toISOString() };
  mutate(db => { db.lastReminderRun = summary; });
  console.log(`[scheduler] תזכורות: משימות ${a}, התייחסויות ${b}, סיכומי Owner ${c}`);
  return summary;
}

function start() {
  if (process.env.DISABLE_SCHEDULER === 'true') return;
  // בודקים כל שעה; שולחים רק בשעה שהוגדרה, בימים א׳–ה׳
  cron.schedule('5 * * * *', async () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: process.env.TZ || 'Asia/Jerusalem' }));
    if (now.getHours() !== Number(settings().reminderHour)) return;
    if (process.env.REMINDERS_ON_WEEKEND !== 'true' && (now.getDay() === 5 || now.getDay() === 6)) return;
    try { await runAll(); } catch (err) { console.error('[scheduler] שגיאה:', err); }
  });
}

module.exports = { start, runAll, runTaskReminders, runResponseReminders, runOwnerDigests, taskInterval };
