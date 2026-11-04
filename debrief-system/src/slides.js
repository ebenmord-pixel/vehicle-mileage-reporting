// =====================================================================
//  מבנה המצגת של התחקיר
//  ---------------------------------------------------------------
//  זה המקום היחיד שמגדיר אילו שקפים מוצגים ובאיזה סדר — גם במצב
//  "ישיבה" באפליקציה וגם בייצוא ל-PowerPoint.
//  כדי להתאים למבנה המצגת הארגונית: שנו סדר, כותרות, או הסירו שקפים.
// =====================================================================
const { q } = require('./db');
const C = require('./constants');

// כל רשומה: type (סוג השקף, קובע את התבנית), title (כותרת), ו-enabled.
const SLIDE_TEMPLATE = [
  { type: 'cover', title: 'שקף פתיחה' },
  { type: 'details', title: 'פרטי האירוע' },
  { type: 'summary', title: 'תיאור האירוע — מה קרה?' },
  { type: 'timeline', title: 'ציר זמן' },
  { type: 'participants', title: 'משתתפים ומחלקות מעורבות' },
  { type: 'responses', title: 'התייחסות' }, // שקף לכל משתתף שהגיש
  { type: 'findings', title: 'ממצאים' },
  { type: 'conclusions', title: 'מסקנות ולקחים' },
  { type: 'tasks', title: 'משימות לשיפור' },
  { type: 'attachments', title: 'נספחים' }, // מוצג רק אם יש נספחים שסומנו להצגה
  { type: 'closing', title: 'סיכום' }
];

// בונה את רשימת השקפים בפועל עבור תחקיר מסוים
function buildSlides(debrief) {
  const slides = [];
  for (const tpl of SLIDE_TEMPLATE) {
    if (tpl.enabled === false) continue;
    if (tpl.type === 'responses') {
      debrief.participants
        .filter(p => p.status === 'submitted')
        .forEach(p => {
          const user = q.user(p.userId);
          const dept = q.department(p.departmentId);
          slides.push({
            type: 'response',
            title: `${tpl.title} ${dept ? dept.name : ''} — ${user ? user.fullName : ''}`,
            participant: p, user, dept
          });
        });
      continue;
    }
    if (tpl.type === 'attachments') {
      const shown = (debrief.attachments || []).filter(a => a.showInPresentation);
      if (!shown.length) continue;
      slides.push({ ...tpl, attachments: shown });
      continue;
    }
    slides.push({ ...tpl });
  }
  return slides;
}

// נתונים מאוחדים לתצוגה/ייצוא
function presentationData(debrief) {
  const tasks = q.tasksForDebrief(debrief.id);
  const participants = debrief.participants.map(p => ({ ...p, user: q.user(p.userId), dept: q.department(p.departmentId) }));
  const deptGroups = {};
  participants.forEach(p => {
    const name = p.dept ? p.dept.name : 'ללא מחלקה';
    (deptGroups[name] = deptGroups[name] || []).push(p);
  });
  return {
    debrief,
    creator: q.user(debrief.createdBy),
    leadDept: q.department(debrief.leadDepartmentId),
    participants,
    deptGroups,
    tasks: tasks.map(t => ({ ...t, assignee: q.user(t.assigneeId) })),
    severity: C.severity(debrief.severity),
    status: C.debriefStatus(debrief.status)
  };
}

module.exports = { SLIDE_TEMPLATE, buildSlides, presentationData };
