// כל ההודעות שהמערכת שולחת במייל.
const { sendMail, layout, escapeHtml: e, baseUrl } = require('./mailer');
const { q } = require('./db');
const C = require('./constants');

function fmtDate(d) {
  if (!d) return '-';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

function respondUrl(participant) {
  return `${baseUrl()}/respond/${participant.token}`;
}

// הזמנה למלא את החלק במחלקה בתחקיר
async function sendParticipantInvite(debrief, participant, { reminder = false } = {}) {
  const user = q.user(participant.userId);
  if (!user) return { sent: false, reason: 'משתמש לא נמצא' };
  const creator = q.user(debrief.createdBy);
  const dept = q.department(participant.departmentId);
  const subject = `${reminder ? 'תזכורת: ' : ''}נדרשת התייחסותך לתחקיר ${debrief.number} — ${debrief.title}`;
  const paragraphs = [
    `שלום ${e(user.fullName)},`,
    `${e(creator ? creator.fullName : 'מנהל התחקיר')} צירף/ה אותך לתחקיר <b>"${e(debrief.title)}"</b> כנציג/ת <b>${e(dept ? dept.name : '')}</b>.`,
    `<b>תאריך האירוע:</b> ${fmtDate(debrief.eventDate)} &nbsp; | &nbsp; <b>חומרה:</b> ${C.severity(debrief.severity).label}`,
    `<b>תקציר:</b> ${e((debrief.summary || '').slice(0, 400))}${(debrief.summary || '').length > 400 ? '…' : ''}`
  ];
  if (participant.request) paragraphs.push(`<b>מה מבקשים ממך:</b> ${e(participant.request)}`);
  if (debrief.responseDueDate) paragraphs.push(`<b>נא למלא עד:</b> ${fmtDate(debrief.responseDueDate)}`);
  const url = respondUrl(participant);
  return sendMail({
    to: user.email,
    subject,
    html: layout({ heading: subject, paragraphs, button: { label: 'למילוי החלק שלי בתחקיר', url } }),
    text: `שלום ${user.fullName}, נדרשת התייחסותך לתחקיר "${debrief.title}". למילוי: ${url}`
  });
}

async function sendTaskAssigned(task) {
  const user = q.user(task.assigneeId);
  if (!user) return { sent: false, reason: 'משתמש לא נמצא' };
  const debrief = task.debriefId ? q.debrief(task.debriefId) : null;
  const subject = `הוקצתה לך משימה: ${task.title}`;
  const url = `${baseUrl()}/tasks/${task.id}`;
  const paragraphs = [
    `שלום ${e(user.fullName)},`,
    `הוקצתה לך משימה לשיפור${debrief ? ` במסגרת תחקיר <b>${e(debrief.number)} — ${e(debrief.title)}</b>` : ''}.`,
    `<b>משימה:</b> ${e(task.title)}`,
    task.description ? `<b>פירוט:</b> ${e(task.description)}` : '',
    `<b>תאריך יעד:</b> ${fmtDate(task.dueDate)} &nbsp; | &nbsp; <b>עדיפות:</b> ${C.priority(task.priority).label}`
  ].filter(Boolean);
  return sendMail({
    to: user.email,
    subject,
    html: layout({ heading: subject, paragraphs, button: { label: 'לצפייה ועדכון התקדמות', url } }),
    text: `הוקצתה לך משימה: ${task.title}. יעד: ${fmtDate(task.dueDate)}. ${url}`
  });
}

// סיכום יומי לבעל משימות: משימות באיחור ומשימות שמועדן מתקרב
async function sendTaskDigest(user, { overdue, dueSoon }) {
  const row = t => `<li>${e(t.title)} — יעד ${fmtDate(t.dueDate)} — ${t.progress || 0}%</li>`;
  const paragraphs = [`שלום ${e(user.fullName)},`];
  if (overdue.length) paragraphs.push(`<b style="color:#b91c1c">משימות שעבר מועד היעד שלהן (${overdue.length}):</b><ul>${overdue.map(row).join('')}</ul>`);
  if (dueSoon.length) paragraphs.push(`<b>משימות שמועדן בשבוע הקרוב (${dueSoon.length}):</b><ul>${dueSoon.map(row).join('')}</ul>`);
  paragraphs.push('נא לעדכן אחוז התקדמות והערות במערכת.');
  const subject = `תזכורת משימות לשיפור — ${overdue.length} באיחור, ${dueSoon.length} בקרוב`;
  return sendMail({
    to: user.email,
    subject,
    html: layout({ heading: subject, paragraphs, button: { label: 'למשימות שלי', url: `${baseUrl()}/tasks?mine=1` } }),
    text: subject
  });
}

// תזכורת תקופתית ל-Owner של משימה (כל X ימים)
async function sendTaskReminder(task, { manual = false } = {}) {
  const user = q.user(task.assigneeId);
  if (!user) return { sent: false, reason: 'אין Owner למשימה' };
  const debrief = task.debriefId ? q.debrief(task.debriefId) : null;
  const overdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10);
  const subject = `${overdue ? '⚠ משימה באיחור' : 'תזכורת'}: ${task.title}`;
  const url = `${baseUrl()}/tasks/${task.id}`;
  const lastNote = (task.notes || []).filter(n => n.text).slice(-1)[0];
  const paragraphs = [
    `שלום ${e(user.fullName)},`,
    `זוהי ${manual ? 'תזכורת' : 'תזכורת תקופתית'} למשימה שבאחריותך${debrief ? ` מתחקיר <b>${e(debrief.number)} — ${e(debrief.title)}</b>` : ''}.`,
    `<b>משימה:</b> ${e(task.title)}`,
    `<b>תאריך יעד:</b> ${fmtDate(task.dueDate)}${overdue ? ' <b style="color:#b91c1c">(עבר המועד)</b>' : ''} &nbsp; | &nbsp; <b>התקדמות נוכחית:</b> ${task.progress || 0}% &nbsp; | &nbsp; <b>סטטוס:</b> ${C.taskStatus(task.status).label}`,
    lastNote ? `<b>עדכון אחרון:</b> ${e(lastNote.text)}` : 'טרם עודכנו הערות למשימה.',
    'נא לעדכן אחוז התקדמות והערה במערכת.'
  ];
  return sendMail({
    to: user.email, subject,
    html: layout({ heading: subject, paragraphs, button: { label: 'לעדכון המשימה', url } }),
    text: `${subject}. יעד: ${fmtDate(task.dueDate)}. התקדמות: ${task.progress || 0}%. ${url}`
  });
}

// סיכום ל-Owner התחקיר: משימות באיחור ומשתתפים שטרם מילאו
async function sendOwnerDigest(owner, items) {
  const subject = `סיכום מעקב לתחקירים שבאחריותך — ${items.reduce((s, i) => s + i.overdue.length, 0)} משימות באיחור`;
  const paragraphs = [`שלום ${e(owner.fullName)},`, 'להלן מצב התחקירים שאת/ה ה-Owner שלהם:'];
  items.forEach(({ debrief, overdue, pending }) => {
    let html = `<b>${e(debrief.number)} — ${e(debrief.title)}</b><ul>`;
    overdue.forEach(t => { html += `<li style="color:#b91c1c">${e(t.title)} — ${e((q.user(t.assigneeId) || {}).fullName || '-')} — יעד ${fmtDate(t.dueDate)} — ${t.progress || 0}%</li>`; });
    if (pending.length) html += `<li>טרם מילאו: ${pending.map(p => e((q.user(p.userId) || {}).fullName || '')).join(', ')}</li>`;
    html += '</ul>';
    paragraphs.push(html);
  });
  return sendMail({
    to: owner.email, subject,
    html: layout({ heading: subject, paragraphs, button: { label: 'לטבלת מעקב השיפורים', url: `${baseUrl()}/tracking` } }),
    text: subject
  });
}

async function sendMeetingInvite(debrief, user) {
  const subject = `זימון לישיבת תחקיר: ${debrief.title}`;
  const m = debrief.meeting || {};
  const paragraphs = [
    `שלום ${e(user.fullName)},`,
    `הנך מוזמן/ת לישיבת התחקיר <b>${e(debrief.number)} — ${e(debrief.title)}</b>.`,
    `<b>מועד:</b> ${fmtDate(m.date)} ${e(m.time || '')} &nbsp; | &nbsp; <b>מיקום:</b> ${e(m.location || '-')}`,
    'מומלץ לעבור על התחקיר לפני הישיבה.'
  ];
  return sendMail({
    to: user.email,
    subject,
    html: layout({ heading: subject, paragraphs, button: { label: 'לצפייה בתחקיר', url: `${baseUrl()}/debriefs/${debrief.id}` } }),
    text: subject
  });
}

module.exports = { sendParticipantInvite, sendTaskAssigned, sendTaskDigest, sendTaskReminder, sendOwnerDigest, sendMeetingInvite, respondUrl, fmtDate };
