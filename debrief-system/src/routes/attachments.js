// נספחים לתחקיר: תמונות, מסמכים, קבצי אקסל/PDF וכו'. נשמרים ב-data/uploads/<debriefId>/
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { q, mutate, nextId, log } = require('../db');
const { requireLogin, forbidden, notFound } = require('../auth');
const { canManage, canView, backTo, flash } = require('../helpers');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'data', 'uploads');
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const BLOCKED = /\.(exe|bat|cmd|com|msi|ps1|vbs|js|sh|scr|dll|jar|html?|svg)$/i;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_ROOT, String(Number(req.params.id)));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    // multer מפענח את שם הקובץ כ-latin1; ממירים ל-UTF-8 כדי לשמור שמות בעברית
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, !BLOCKED.test(file.originalname));
  }
});

function isImage(a) { return /^image\/(png|jpe?g|gif|webp|bmp)$/.test(a.mimeType); }

// כל משתתף בתחקיר יכול לצרף נספחים (לא רק המנהל) — למשל צילומי מסך מהתקלה
router.post('/debriefs/:id/attachments', requireLogin, (req, res, next) => {
  const d = q.debrief(req.params.id);
  if (!d) return notFound(res);
  if (!canView(req.user, d)) return forbidden(res);
  upload.array('files', 10)(req, res, err => {
    if (err) {
      flash(req, 'error', err.code === 'LIMIT_FILE_SIZE' ? `קובץ גדול מדי (מקסימום ${MAX_MB}MB)` : 'שגיאה בהעלאה: ' + err.message);
      return res.redirect(backTo(req, `/debriefs/${d.id}#attachments`));
    }
    const files = req.files || [];
    if (!files.length) {
      flash(req, 'warning', 'לא נבחרו קבצים (או שסוג הקובץ אינו מותר)');
      return res.redirect(backTo(req, `/debriefs/${d.id}#attachments`));
    }
    mutate(db => {
      const x = db.debriefs.find(y => y.id === d.id);
      x.attachments = x.attachments || [];
      files.forEach(f => {
        x.attachments.push({
          id: nextId(db, 'item'),
          originalName: f.originalname,
          storedName: f.filename,
          mimeType: f.mimetype,
          size: f.size,
          description: (req.body.description || '').trim(),
          showInPresentation: req.body.showInPresentation === 'on',
          uploadedBy: req.user.id,
          uploadedAt: new Date().toISOString()
        });
      });
      log(db, { userId: req.user.id, debriefId: d.id, text: `צירף/ה ${files.length} נספחים: ${files.map(f => f.originalname).join(', ')}` });
    });
    flash(req, 'success', `${files.length} קבצים צורפו`);
    res.redirect(backTo(req, `/debriefs/${d.id}#attachments`));
  });
});

function findAttachment(req, res) {
  const d = q.debrief(req.params.id);
  if (!d) { notFound(res); return {}; }
  if (!canView(req.user, d)) { forbidden(res); return {}; }
  const a = (d.attachments || []).find(x => x.id === Number(req.params.aid));
  if (!a) { notFound(res, 'הנספח לא נמצא'); return {}; }
  return { d, a };
}

router.get('/debriefs/:id/attachments/:aid', requireLogin, (req, res) => {
  const { d, a } = findAttachment(req, res); if (!a) return;
  const file = path.join(UPLOAD_ROOT, String(d.id), path.basename(a.storedName));
  if (!fs.existsSync(file)) return notFound(res, 'הקובץ אינו קיים בשרת');
  const inline = req.query.inline === '1' && (isImage(a) || a.mimeType === 'application/pdf');
  res.setHeader('Content-Type', a.mimeType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.originalName)}`);
  fs.createReadStream(file).pipe(res);
});

router.post('/debriefs/:id/attachments/:aid/toggle', requireLogin, (req, res) => {
  const { d, a } = findAttachment(req, res); if (!a) return;
  if (!canManage(req.user, d)) return forbidden(res);
  mutate(db => {
    const x = db.debriefs.find(y => y.id === d.id).attachments.find(z => z.id === a.id);
    x.showInPresentation = !x.showInPresentation;
  });
  res.redirect(backTo(req, `/debriefs/${d.id}#attachments`));
});

router.post('/debriefs/:id/attachments/:aid/delete', requireLogin, (req, res) => {
  const { d, a } = findAttachment(req, res); if (!a) return;
  if (!canManage(req.user, d) && a.uploadedBy !== req.user.id) return forbidden(res);
  mutate(db => {
    const x = db.debriefs.find(y => y.id === d.id);
    x.attachments = x.attachments.filter(z => z.id !== a.id);
    log(db, { userId: req.user.id, debriefId: d.id, text: `מחק/ה את הנספח ${a.originalName}` });
  });
  fs.rm(path.join(UPLOAD_ROOT, String(d.id), path.basename(a.storedName)), { force: true }, () => {});
  res.redirect(backTo(req, `/debriefs/${d.id}#attachments`));
});

module.exports = router;
module.exports.isImage = isImage;
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;
