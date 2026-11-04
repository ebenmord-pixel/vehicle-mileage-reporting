// שכבת נתונים פשוטה מבוססת קובץ JSON (data/db.json).
// מתאים לארגון קטן-בינוני; ניתן להחליף בעתיד ל-SQL בלי לשנות את הנתיבים.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_DEPARTMENTS = ['הנהלה', 'תפעול', 'איכות', 'הנדסה', 'מערכות מידע', 'לוגיסטיקה', 'שירות לקוחות', 'בטיחות'];

function newToken() {
  return crypto.randomBytes(20).toString('hex');
}

function seed() {
  const db = {
    seq: { user: 1, department: 1, debrief: 1, participant: 1, item: 1, task: 1, note: 1, log: 1 },
    departments: [],
    users: [],
    debriefs: [],
    tasks: [],
    activity: []
  };
  DEFAULT_DEPARTMENTS.forEach(name => db.departments.push({ id: db.seq.department++, name }));
  db.users.push({
    id: db.seq.user++,
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10),
    fullName: 'מנהל מערכת',
    email: '',
    jobTitle: 'מנהל מערכת',
    departmentId: db.departments[0].id,
    role: 'admin',
    active: true
  });
  return db;
}

let cache = null;

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DB_PATH)) {
    cache = seed();
    save();
  } else {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  }
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

// מריץ שינוי ושומר. מחזיר את מה שהפונקציה מחזירה.
function mutate(fn) {
  const db = load();
  const result = fn(db);
  save();
  return result;
}

function nextId(db, kind) {
  return db.seq[kind]++;
}

function log(db, { userId, debriefId, text }) {
  db.activity.push({ id: nextId(db, 'log'), at: new Date().toISOString(), userId: userId || null, debriefId: debriefId || null, text });
  if (db.activity.length > 5000) db.activity.splice(0, db.activity.length - 5000);
}

// --- שאילתות עזר ---
const DEFAULT_SETTINGS = {
  taskReminderDays: 7,       // תזכורת ל-Owner של משימה פתוחה כל X ימים (0 = כבוי)
  overdueReminderDays: 2,    // משימה באיחור — תזכורת בתדירות גבוהה יותר
  responseReminderDays: 2,   // תזכורת למשתתף שטרם מילא את חלקו
  ownerDigestDays: 7,        // סיכום ל-Owner התחקיר על משימות באיחור
  reminderHour: 8            // שעת שליחת התזכורות
};

function settings() {
  const db = load();
  return { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
}

const q = {
  user: id => load().users.find(u => u.id === Number(id)),
  userByUsername: username => load().users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase()),
  users: () => load().users.slice().sort((a, b) => a.fullName.localeCompare(b.fullName, 'he')),
  activeUsers: () => q.users().filter(u => u.active !== false),
  department: id => load().departments.find(d => d.id === Number(id)),
  departments: () => load().departments.slice().sort((a, b) => a.name.localeCompare(b.name, 'he')),
  debrief: id => load().debriefs.find(d => d.id === Number(id)),
  debriefs: () => load().debriefs.slice().sort((a, b) => b.id - a.id),
  participantByToken: token => {
    for (const d of load().debriefs) {
      const p = d.participants.find(x => x.token === token);
      if (p) return { debrief: d, participant: p };
    }
    return null;
  },
  task: id => load().tasks.find(t => t.id === Number(id)),
  tasks: () => load().tasks.slice(),
  tasksForDebrief: debriefId => load().tasks.filter(t => t.debriefId === Number(debriefId)),
  lastReminderRun: () => load().lastReminderRun || null,
  activityForDebrief: debriefId => load().activity.filter(a => a.debriefId === Number(debriefId)).sort((a, b) => b.id - a.id)
};

module.exports = { settings, DEFAULT_SETTINGS, load, save, mutate, nextId, log, newToken, q, DB_PATH };
