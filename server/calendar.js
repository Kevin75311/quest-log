// Parses the Gemini calendar export (calendar.md in personal-os) into events.
// Format handled:
//   ### Friday, November 6, 2026
//   - **10:00 – 10:50 PST:** [Title](url)
//     - Location: ...
//   - **All Day:** [Title](url)
//   - **Free Slot:** [Title](url)
'use strict';
const fs = require('fs');

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function parseCalendarMd(text) {
  const out = []; let date = null, cur = null; let exportedAt = null, covered = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /\*\*Export Time:\*\*\s*(.+)$/.exec(line))) exportedAt = m[1].trim();
    if ((m = /\*\*Covered Dates:\*\*\s*(.+)$/.exec(line))) covered = m[1].trim();
    if ((m = /^###\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/.exec(line))) {
      const mo = MONTHS[m[1].toLowerCase()]; date = mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; cur = null; continue;
    }
    if (!date) continue;
    if ((m = /^- \*\*(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})[^*]*:\*\*\s*(.+)$/.exec(line))) {
      cur = { date, start: m[1].padStart(5, '0'), end: m[2].padStart(5, '0'), ...titleUrl(m[3]), source: 'google' }; out.push(cur); continue;
    }
    if ((m = /^- \*\*(All Day|Free Slot):\*\*\s*(.+)$/.exec(line))) {
      cur = { date, allDay: true, free: m[1] === 'Free Slot', ...titleUrl(m[2]), source: 'google' }; out.push(cur); continue;
    }
    if (cur && (m = /^\s+- Location:\s*(.+)$/.exec(line))) cur.location = m[1].replace(/\(https?:[^)]*\)/g, '').trim();
    if (cur && (m = /^\s+- Conflict Note:\s*(.+)$/.exec(line))) cur.conflict = m[1].trim();
  }
  return { events: out, exportedAt, covered };
}
function titleUrl(s) {
  const m = /^\[(.+?)\]\((https?:[^)]+)\)/.exec(s.trim());
  return m ? { title: m[1], url: m[2] } : { title: s.replace(/[*[\]]/g, '').trim() };
}
function readCalendar(file) {
  try { return { ...parseCalendarMd(fs.readFileSync(file, 'utf8')), ok: true }; }
  catch (e) { return { events: [], ok: false, error: e.code === 'ENOENT' ? 'calendar.md not found' : e.message }; }
}
module.exports = { parseCalendarMd, readCalendar };
