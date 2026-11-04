// ייצוא התחקיר למצגת PowerPoint (עברית, מימין לשמאל), לפי אותו מבנה שקפים של מצב הישיבה.
const PptxGenJS = require('pptxgenjs');
const { buildSlides, presentationData } = require('./slides');
const C = require('./constants');
const { fmtDate } = require('./notifications');
const { q } = require('./db');
const fs = require('fs');
const path = require('path');
const UPLOAD_ROOT = path.join(__dirname, '..', 'data', 'uploads');

const NAVY = '0F2A5C', ACCENT = '1D4ED8', GRAY = '64748B', LIGHT = 'F1F5F9';
const FONT = 'Arial';
const SEV_COLORS = { low: '16A34A', medium: 'CA8A04', high: 'EA580C', critical: 'DC2626' };

const rtl = (opts = {}) => ({ fontFace: FONT, rtlMode: true, align: 'right', color: '0F172A', ...opts });

function header(slide, title, d, index, total) {
  slide.background = { color: 'FFFFFF' };
  slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: NAVY } });
  slide.addText(title, rtl({ x: 0.4, y: 0.1, w: 12.5, h: 0.7, fontSize: 26, bold: true, color: 'FFFFFF' }));
  slide.addShape('rect', { x: 0, y: 7.2, w: 13.33, h: 0.3, fill: { color: LIGHT } });
  slide.addText(`תחקיר ${d.number} — ${d.title}`, rtl({ x: 3, y: 7.2, w: 10, h: 0.3, fontSize: 10, color: GRAY }));
  slide.addText(`${index} / ${total}`, { x: 0.3, y: 7.2, w: 1.5, h: 0.3, fontSize: 10, color: GRAY, fontFace: FONT, align: 'left' });
}

function bullets(slide, items, box = {}) {
  const runs = items.length
    ? items.map(t => ({ text: t, options: { bullet: { indent: 18 }, paraSpaceAfter: 6 } }))
    : [{ text: '—', options: {} }];
  slide.addText(runs, rtl({ x: 0.5, y: 1.2, w: 12.3, h: 5.8, fontSize: 18, valign: 'top', ...box }));
}

function table(slide, head, rows, colW, opts = {}) {
  const hdr = head.map(h => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT }, align: 'right', rtlMode: true } }));
  const body = rows.map((r, i) => r.map(c => (typeof c === 'object' && c !== null ? c : { text: String(c ?? ''), options: { align: 'right', rtlMode: true, fill: { color: i % 2 ? 'FFFFFF' : 'F8FAFC' } } })));
  // בטבלה בעברית העמודה הראשונה מימין — הופכים את סדר העמודות
  slide.addTable([hdr.reverse(), ...body.map(r => r.slice().reverse())], {
    x: 0.5, y: 1.2, w: 12.3, colW: colW.slice().reverse(), fontFace: FONT, fontSize: 13,
    border: { type: 'solid', color: 'CBD5E1', pt: 0.5 }, autoPage: true, autoPageRepeatHeader: true, newSlideStartY: 1.2, ...opts
  });
}

async function buildPptx(debrief, { timeline }) {
  const data = presentationData(debrief);
  const { debrief: d } = data;
  const slides = buildSlides(d);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = true;
  pptx.title = `תחקיר ${d.number} — ${d.title}`;

  slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    const n = i + 1, total = slides.length;
    switch (s.type) {
      case 'cover': {
        slide.background = { color: NAVY };
        slide.addText('תחקיר', rtl({ x: 0.8, y: 1.4, w: 11.7, h: 0.8, fontSize: 28, color: '93C5FD' }));
        slide.addText(d.title, rtl({ x: 0.8, y: 2.2, w: 11.7, h: 1.6, fontSize: 44, bold: true, color: 'FFFFFF' }));
        slide.addText([
          { text: `מס׳ תחקיר: ${d.number}`, options: { breakLine: true } },
          { text: `תאריך האירוע: ${fmtDate(d.eventDate)}`, options: { breakLine: true } },
          { text: `מחלקה מובילה: ${data.leadDept ? data.leadDept.name : '-'}`, options: { breakLine: true } },
          { text: `מנחה התחקיר: ${(q.user(d.facilitatorId) || {}).fullName || '-'}`, options: { breakLine: true } },
          { text: `מועד הישיבה: ${fmtDate(d.meeting.date)}` }
        ], rtl({ x: 0.8, y: 4.1, w: 11.7, h: 2.4, fontSize: 20, color: 'E2E8F0', valign: 'top' }));
        break;
      }
      case 'details': {
        header(slide, s.title, d, n, total);
        const rows = [
          ['כותרת', d.title], ['תאריך ושעה', `${fmtDate(d.eventDate)} ${d.eventTime || ''}`], ['מיקום', d.location || '-'],
          ['קטגוריה', d.category || '-'], ['חומרה', { text: C.severity(d.severity).label, options: { bold: true, color: SEV_COLORS[d.severity] || '000000', align: 'right', rtlMode: true } }],
          ['מחלקה מובילה', data.leadDept ? data.leadDept.name : '-'], ['פותח התחקיר', data.creator ? data.creator.fullName : '-'],
          ['השפעה / נזק', d.impact || '-'], ['פעולות מיידיות', d.immediateActions || '-']
        ];
        table(slide, ['נושא', 'פירוט'], rows, [3, 9.3]);
        break;
      }
      case 'summary':
        header(slide, s.title, d, n, total);
        slide.addText(d.summary || '-', rtl({ x: 0.5, y: 1.2, w: 12.3, h: 5.8, fontSize: 20, valign: 'top' }));
        break;
      case 'timeline':
        header(slide, s.title, d, n, total);
        table(slide, ['מועד', 'מה קרה', 'מקור'],
          timeline.length ? timeline.map(t => [`${t.date ? fmtDate(t.date) : ''} ${t.time || ''}`.trim(), t.description, t.source || 'פותח התחקיר']) : [['', 'לא הוזן ציר זמן', '']],
          [2.3, 7.8, 2.2]);
        break;
      case 'participants':
        header(slide, s.title, d, n, total);
        table(slide, ['מחלקה', 'משתתף', 'תפקיד', 'סטטוס התייחסות'],
          data.participants.length ? data.participants.map(p => [p.dept ? p.dept.name : '-', p.user ? p.user.fullName : '-', p.user ? p.user.jobTitle || '' : '', p.status === 'submitted' ? 'הוגש' : 'טרם הוגש'])
            : [['', 'לא הוקצו משתתפים', '', '']],
          [3, 3.5, 3, 2.8]);
        break;
      case 'response': {
        header(slide, s.title, d, n, total);
        const r = s.participant.response || {};
        const parts = [];
        C.RESPONSE_FIELDS.forEach(f => {
          if (!r[f.key]) return;
          parts.push({ text: f.label, options: { bold: true, color: ACCENT, breakLine: true, fontSize: 15 } });
          parts.push({ text: r[f.key], options: { breakLine: true, fontSize: 14, paraSpaceAfter: 8 } });
        });
        slide.addText(parts.length ? parts : [{ text: '-' }], rtl({ x: 0.5, y: 1.1, w: 12.3, h: 6, valign: 'top', fit: 'shrink' }));
        break;
      }
      case 'findings':
        header(slide, s.title, d, n, total);
        table(slide, ['#', 'ממצא', 'סוג', 'גורם שורש', 'מחלקה'],
          d.findings.length ? d.findings.map((f, k) => [k + 1, f.text, C.findingType(f.type).label, f.rootCause || '-', (q.department(f.departmentId) || {}).name || '-'])
            : [['', 'טרם הוזנו ממצאים', '', '', '']],
          [0.6, 6.4, 1.8, 1.8, 1.7]);
        break;
      case 'conclusions':
        header(slide, s.title, d, n, total);
        bullets(slide, d.conclusions.map(c => c.text));
        break;
      case 'tasks':
        header(slide, s.title, d, n, total);
        table(slide, ['#', 'משימה', 'Owner', 'תאריך יעד', 'סטטוס', 'התקדמות'],
          data.tasks.length ? data.tasks.map((t, k) => [k + 1, t.title, t.assignee ? t.assignee.fullName : '-', fmtDate(t.dueDate), C.taskStatus(t.status).label, `${t.progress || 0}%`])
            : [['', 'טרם הוגדרו משימות', '', '', '', '']],
          [0.6, 5.5, 2.2, 1.6, 1.3, 1.1]);
        break;
      case 'attachments': {
        header(slide, s.title, d, n, total);
        const imgs = s.attachments.filter(a => /^image\/(png|jpe?g|gif)$/.test(a.mimeType));
        const others = s.attachments.filter(a => !imgs.includes(a));
        imgs.slice(0, 4).forEach((a, k) => {
          const file = path.join(UPLOAD_ROOT, String(d.id), path.basename(a.storedName));
          if (!fs.existsSync(file)) return;
          const col = k % 2, row = Math.floor(k / 2);
          const x = 12.83 - (col + 1) * 6.15, y = 1.1 + row * 3;
          slide.addImage({ path: file, x, y, w: 6, h: 2.6, sizing: { type: 'contain', w: 6, h: 2.6 } });
          slide.addText(a.description || a.originalName, rtl({ x, y: y + 2.6, w: 6, h: 0.3, fontSize: 11, color: GRAY, align: 'center' }));
        });
        if (others.length || imgs.length > 4) {
          const list = [...imgs.slice(4), ...others].map(a => `${a.originalName}${a.description ? ' — ' + a.description : ''}`);
          bullets(slide, list, imgs.length ? { y: 6.2, h: 0.9, fontSize: 12 } : {});
        }
        break;
      }
      case 'closing':
        header(slide, s.title, d, n, total);
        slide.addText(d.closingSummary || `ממצאים: ${d.findings.length} | מסקנות: ${d.conclusions.length} | משימות: ${data.tasks.length}`,
          rtl({ x: 0.5, y: 1.4, w: 12.3, h: 5, fontSize: 22, valign: 'top' }));
        break;
      default:
        header(slide, s.title, d, n, total);
    }
  });

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { buildPptx };
