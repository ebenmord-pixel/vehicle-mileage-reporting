// קבועים ותוויות בעברית — מקום אחד לשינוי מונחים.

const DEBRIEF_STATUSES = [
  { key: 'draft', label: 'טיוטה', color: 'gray' },
  { key: 'collecting', label: 'איסוף התייחסויות', color: 'blue' },
  { key: 'ready', label: 'מוכן לישיבה', color: 'purple' },
  { key: 'meeting', label: 'בישיבת תחקיר', color: 'orange' },
  { key: 'followup', label: 'במעקב משימות', color: 'teal' },
  { key: 'closed', label: 'סגור', color: 'green' }
];

const SEVERITIES = [
  { key: 'low', label: 'נמוכה', color: 'green' },
  { key: 'medium', label: 'בינונית', color: 'yellow' },
  { key: 'high', label: 'גבוהה', color: 'orange' },
  { key: 'critical', label: 'קריטית', color: 'red' }
];

const CATEGORIES = ['תפעולית', 'איכות', 'בטיחות', 'מערכות מידע', 'שירות לקוחות', 'לוגיסטיקה', 'אבטחת מידע', 'אחר'];

const TASK_STATUSES = [
  { key: 'open', label: 'פתוחה', color: 'gray' },
  { key: 'in_progress', label: 'בביצוע', color: 'blue' },
  { key: 'blocked', label: 'תקועה', color: 'red' },
  { key: 'done', label: 'הושלמה', color: 'green' },
  { key: 'cancelled', label: 'בוטלה', color: 'gray' }
];

const PRIORITIES = [
  { key: 'low', label: 'נמוכה', color: 'green' },
  { key: 'medium', label: 'בינונית', color: 'yellow' },
  { key: 'high', label: 'גבוהה', color: 'red' }
];

const FINDING_TYPES = [
  { key: 'negative', label: 'ליקוי / כשל', color: 'red' },
  { key: 'positive', label: 'נקודה לשימור', color: 'green' },
  { key: 'neutral', label: 'ממצא כללי', color: 'gray' }
];

// סוגי גורם שורש (לסיווג ממצאים וניתוח מגמות)
const ROOT_CAUSE_TYPES = ['נהלים', 'הדרכה / ידע', 'תקשורת', 'ציוד / מערכת', 'תכנון', 'גורם אנושי', 'ספק חיצוני', 'אחר'];

// השדות שכל משתתף ממלא ב"חלק שלו" — שינוי כאן משנה את הטופס, את התצוגה ואת המצגת.
const RESPONSE_FIELDS = [
  { key: 'whatHappened', label: 'מה קרה מנקודת המבט שלי / של המחלקה', rows: 5, required: true },
  { key: 'actionsTaken', label: 'אילו פעולות בוצענו בזמן האירוע', rows: 3 },
  { key: 'causes', label: 'מה לדעתי גרם לתקלה (גורמים ישירים ושורש)', rows: 3 },
  { key: 'wentWell', label: 'מה עבד טוב — לשימור', rows: 3 },
  { key: 'toImprove', label: 'מה לא עבד — לשיפור', rows: 3 },
  { key: 'suggestions', label: 'הצעות לשיפור / למניעת הישנות', rows: 3 }
];

function find(list, key) {
  return list.find(x => x.key === key) || { key, label: key || '-', color: 'gray' };
}

module.exports = {
  DEBRIEF_STATUSES, SEVERITIES, CATEGORIES, TASK_STATUSES, PRIORITIES, FINDING_TYPES, ROOT_CAUSE_TYPES, RESPONSE_FIELDS,
  debriefStatus: k => find(DEBRIEF_STATUSES, k),
  severity: k => find(SEVERITIES, k),
  taskStatus: k => find(TASK_STATUSES, k),
  priority: k => find(PRIORITIES, k),
  findingType: k => find(FINDING_TYPES, k)
};
