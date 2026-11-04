// שליחת מיילים דרך SMTP (ברירת מחדל: Microsoft 365 / Outlook).
// אם SMTP לא מוגדר — המייל נרשם ביומן (outbox) כדי שלא ייעלם, ומוצג קישור mailto כגיבוי.
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const OUTBOX = path.join(__dirname, '..', 'data', 'outbox.log');

function isConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function baseUrl() {
  return (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3100}`).replace(/\/$/, '');
}

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.office365.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      requireTLS: Number(process.env.SMTP_PORT) !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transport;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// תבנית HTML אחידה ב-RTL
function layout({ heading, paragraphs = [], button, footer }) {
  const body = paragraphs.map(p => `<p style="margin:0 0 12px;line-height:1.6">${p}</p>`).join('');
  const btn = button
    ? `<p style="margin:20px 0"><a href="${escapeHtml(button.url)}" style="background:#1d4ed8;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(button.label)}</a></p>
       <p style="font-size:12px;color:#64748b">אם הכפתור לא עובד, העתיקו את הקישור: <br><span dir="ltr">${escapeHtml(button.url)}</span></p>`
    : '';
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0" dir="rtl">
    <div style="background:#0f2a5c;color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">מערכת ניהול תחקירים</div>
    <div style="padding:24px;text-align:right">
      <h2 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h2>
      ${body}${btn}
    </div>
    <div style="padding:12px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:right">${footer || 'הודעה זו נשלחה אוטומטית ממערכת ניהול התחקירים.'}</div>
  </div></body></html>`;
}

async function sendMail({ to, subject, html, text }) {
  if (!to) return { sent: false, reason: 'לנמען אין כתובת מייל' };
  const record = `[${new Date().toISOString()}] TO: ${to} | SUBJECT: ${subject}\n${text || ''}\n\n`;
  if (!isConfigured()) {
    fs.mkdirSync(path.dirname(OUTBOX), { recursive: true });
    fs.appendFileSync(OUTBOX, record, 'utf8');
    return { sent: false, reason: 'SMTP לא מוגדר — המייל נשמר ב-data/outbox.log' };
  }
  try {
    await getTransport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html, text });
    return { sent: true };
  } catch (err) {
    console.error('שגיאה בשליחת מייל ל-' + to + ':', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { isConfigured, sendMail, layout, escapeHtml, baseUrl };
