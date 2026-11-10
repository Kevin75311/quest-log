// Google Calendar secret-iCal sync for Quest Log: fetches .ics feeds, expands recurring events,
// and writes calendar.md in the same format the Gemini export used (parsed by calendar.js).
'use strict';
const fs = require('fs');

// ---------- time zone helpers ----------
const dtf = {};
function fmt(tz) { return dtf[tz] || (dtf[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', timeZoneName: 'short' })); }
function parts(ms, tz) { const o = {}; for (const p of fmt(tz).formatToParts(new Date(ms))) o[p.type] = p.value; return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd: o.weekday, tzn: o.timeZoneName }; }
function offset(ms, tz) { const p = parts(ms, tz); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms; }
function zoned(y, mo, d, h, mi, s, tz) { // wall time in tz -> UTC ms
  if (!tz || tz === 'UTC') return Date.UTC(y, mo - 1, d, h, mi, s);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s); let t = guess - offset(guess, tz); t = guess - offset(t, tz); return t;
}

// ---------- ICS parsing ----------
function unfold(text) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
function unesc(v) { return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }
function parseProp(line) {
  const i = line.indexOf(':'); if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1); const [name, ...ps] = head.split(';'); const params = {};
  ps.forEach(p => { const j = p.indexOf('='); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ''); });
  return { name: name.toUpperCase(), params, value };
}
// returns {ms, allDay, date:'YYYY-MM-DD', wall:{y,mo,d,h,mi,s}, tz}
function parseDT(p, calTz) {
  const v = p.value.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) { const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8); return { allDay: true, wall: { y, mo, d, h: 0, mi: 0, s: 0 }, date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` }; }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v); if (!m) return null;
  const w = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
  const tz = m[7] ? 'UTC' : (p.params.TZID || calTz || 'UTC');
  return { allDay: false, wall: w, tz, ms: zoned(w.y, w.mo, w.d, w.h, w.mi, w.s, tz) };
}
function parseICS(text, label) {
  const lines = unfold(text).split('\n'); const evs = []; let cur = null, calTz = null, depth = 0, calName = label;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) evs.push(cur); cur = null; continue; }
    if (line.startsWith('BEGIN:')) depth++; else if (line.startsWith('END:')) depth--;
    const p = parseProp(line); if (!p) continue;
    if (!cur) { if (p.name === 'X-WR-TIMEZONE') calTz = p.value.trim(); if (p.name === 'X-WR-CALNAME') calName = unesc(p.value); continue; }
    switch (p.name) {
      case 'UID': cur.uid = p.value.trim(); break;
      case 'SUMMARY': cur.summary = unesc(p.value); break;
      case 'LOCATION': cur.location = unesc(p.value); break;
      case 'STATUS': cur.status = p.value.trim().toUpperCase(); break;
      case 'TRANSP': cur.transp = p.value.trim().toUpperCase(); break;
      case 'DTSTART': cur.startP = p; break;
      case 'DTEND': cur.endP = p; break;
      case 'DURATION': cur.duration = p.value.trim(); break;
      case 'RRULE': cur.rrule = Object.fromEntries(p.value.split(';').map(kv => kv.split('='))); break;
      case 'EXDATE': p.value.split(',').forEach(v => cur.exdates.push({ name: 'EXDATE', params: p.params, value: v })); break;
      case 'RECURRENCE-ID': cur.recurP = p; break;
    }
  }
  evs.forEach(e => { e.cal = calName; e.calTz = calTz; });
  return evs;
}
function durMs(s) { const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s || ''); if (!m) return 0; return ((+m[1] || 0) * 7 * 864e5) + ((+m[2] || 0) * 864e5) + ((+m[3] || 0) * 36e5) + ((+m[4] || 0) * 6e4) + ((+m[5] || 0) * 1e3); }

// ---------- recurrence expansion (wall-clock in the event's zone, so DST keeps local times) ----------
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function addDays(w, n) { const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + n)); return { ...w, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function dow(w) { return new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay(); }
function daysInMonth(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }
function expand(e, winStart, winEnd) {
  const s = parseDT(e.startP, e.calTz); if (!s) return [];
  const eP = e.endP ? parseDT(e.endP, e.calTz) : null;
  const toMs = w => s.allDay ? Date.UTC(w.y, w.mo - 1, w.d) : zoned(w.y, w.mo, w.d, w.h, w.mi, w.s, s.tz);
  const startMs = toMs(s.wall);
  const len = eP ? (toMs(eP.wall) - startMs) : (e.duration ? durMs(e.duration) : (s.allDay ? 864e5 : 0));
  const occ = [];
  const push = w => occ.push({ wall: w, ms: toMs(w) });
  if (!e.rrule) { push(s.wall); }
  else {
    const r = e.rrule, freq = r.FREQ, iv = +(r.INTERVAL || 1); const count = r.COUNT ? +r.COUNT : Infinity;
    let until = Infinity; if (r.UNTIL) { const u = parseDT({ value: r.UNTIL, params: {} }, 'UTC'); until = u.allDay ? Date.UTC(u.wall.y, u.wall.mo - 1, u.wall.d, 23, 59, 59) : u.ms; }
    const byday = r.BYDAY ? r.BYDAY.split(',') : null, bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
    let n = 0, guard = 0; const stop = ms => ms > until || ms > winEnd || n >= count;
    const emit = w => { const ms = toMs(w); if (ms < startMs) return true; if (stop(ms)) return false; n++; push(w); return true; };
    if (freq === 'DAILY') { for (let k = 0; guard++ < 5000; k += iv) { if (!emit(addDays(s.wall, k))) break; } }
    else if (freq === 'WEEKLY') {
      const days = (byday || [WD[dow(s.wall)]]).map(x => WD.indexOf(x.slice(-2))).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      const wkStart = addDays(s.wall, -((dow(s.wall) + 6) % 7)); // Monday of DTSTART's week
      outer: for (let k = 0; guard++ < 2000; k += iv) { const base = addDays(wkStart, 7 * k); for (const d of days) { if (!emit(addDays(base, (d + 6) % 7))) break outer; } }
    } else if (freq === 'MONTHLY') {
      outer2: for (let k = 0; guard++ < 600; k += iv) {
        const y = s.wall.y + Math.floor((s.wall.mo - 1 + k) / 12), mo = ((s.wall.mo - 1 + k) % 12) + 1, dim = daysInMonth(y, mo); let ds = [];
        if (bymd) ds = bymd.map(x => x < 0 ? dim + 1 + x : x);
        else if (byday) byday.forEach(b => { const m = /^([+-]?\d+)?(\w\w)$/.exec(b); const wd = WD.indexOf(m[2]); const all = []; for (let d = 1; d <= dim; d++) if (dow({ y, mo, d }) === wd) all.push(d); if (m[1]) { const i = +m[1]; const v = i > 0 ? all[i - 1] : all[all.length + i]; if (v) ds.push(v); } else ds.push(...all); });
        else ds = [s.wall.d];
        for (const d of ds.filter(d => d >= 1 && d <= dim).sort((a, b) => a - b)) if (!emit({ ...s.wall, y, mo, d })) break outer2;
      }
    } else if (freq === 'YEARLY') { for (let k = 0; guard++ < 200; k += iv) { if (!emit({ ...s.wall, y: s.wall.y + k })) break; } }
    else push(s.wall);
  }
  const ex = new Set(e.exdates.map(p => { const d = parseDT(p, s.tz || e.calTz); return d ? (d.allDay ? Date.UTC(d.wall.y, d.wall.mo - 1, d.wall.d) : d.ms) : null; }));
  return occ.filter(o => !ex.has(o.ms) && o.ms + Math.max(len, 1) > winStart && o.ms < winEnd).map(o => ({ ms: o.ms, end: o.ms + len, allDay: s.allDay, wall: o.wall, len }));
}

function buildEvents(feeds, winStart, winEnd) {
  const all = []; const overrides = new Map();
  feeds.forEach(evs => evs.forEach(e => { if (e.recurP) { const d = parseDT(e.recurP, e.calTz); if (d) overrides.set(e.uid + '|' + (d.allDay ? Date.UTC(d.wall.y, d.wall.mo - 1, d.wall.d) : d.ms), true); } }));
  feeds.forEach(evs => evs.forEach(e => {
    if (!e.startP) return;
    expand(e, winStart, winEnd).forEach(o => {
      if (!e.recurP && e.rrule && overrides.has(e.uid + '|' + o.ms)) return; // replaced by an edited instance
      if (e.status === 'CANCELLED') return;
      all.push({ ...o, title: e.summary || '(no title)', location: e.location, cal: e.cal, free: e.transp === 'TRANSPARENT' });
    });
  }));
  return all;
}

// ---------- markdown ----------
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYN = { Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const pad = n => String(n).padStart(2, '0');
function cleanLoc(s) { return (s || '').replace(/([?&](pwd|passcode|password)=)[^&\s)]+/gi, '').replace(/\s+/g, ' ').trim(); }
function renderMd(events, { tz, calendars, from, to, now }) {
  const byDate = new Map();
  const add = (date, line) => { if (!byDate.has(date)) byDate.set(date, []); byDate.get(date).push(line); };
  events.forEach(e => {
    if (e.allDay) {
      const days = Math.max(1, Math.round(e.len / 864e5));
      for (let k = 0; k < days; k++) { const w = addDays(e.wall, k); const date = `${w.y}-${pad(w.mo)}-${pad(w.d)}`; if (date < from || date > to) continue; add(date, { sort: -1, text: `- **${e.free ? 'Free Slot' : 'All Day'}:** ${e.title}`, e }); }
    } else {
      const a = parts(e.ms, tz), b = parts(e.end, tz), date = `${a.y}-${pad(a.mo)}-${pad(a.d)}`; if (date < from || date > to) return;
      add(date, { sort: a.h * 60 + a.mi, text: `- **${pad(a.h)}:${pad(a.mi)} – ${pad(b.h)}:${pad(b.mi)} ${a.tzn}:** ${e.title}`, e });
    }
  });
  const np = parts(now, tz);
  const L = ['# Calendar Export', '',
    `- **Export Time:** ${np.y}-${pad(np.mo)}-${pad(np.d)} ${pad(np.h)}:${pad(np.mi)}:${pad(np.s)} ${np.tzn}`,
    `- **Timezone:** ${tz}`, `- **Covered Dates:** ${from} to ${to}`, `- **Calendars:** ${calendars.join(', ')}`,
    '- **Source:** Google Calendar private iCal feeds, fetched by the Quest Log server on the Raspberry Pi every 15 minutes. Generated file: do not edit by hand. Google Calendar remains the authority for live events.',
    '', '## Events by Date', ''];
  [...byDate.keys()].sort().forEach(date => {
    const [y, mo, d] = date.split('-').map(Number); const wd = new Date(Date.UTC(y, mo - 1, d)).toUTCString().slice(0, 3);
    L.push(`### ${DAYN[wd]}, ${MON[mo - 1]} ${d}, ${y}`);
    byDate.get(date).sort((x, z) => x.sort - z.sort || x.text.localeCompare(z.text)).forEach(({ text, e }) => {
      L.push(text); const loc = cleanLoc(e.location); if (loc) L.push(`  - Location: ${loc}`); L.push(`  - Calendar: ${e.cal}`);
    });
    L.push('');
  });
  return L.join('\n');
}

async function syncCalendars({ urlsFile, outFile, tz, pastDays = 7, futureDays = 180, now = Date.now() }) {
  const urls = fs.readFileSync(urlsFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const feeds = [], names = [];
  for (const u of urls) {
    const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`iCal fetch failed (${r.status})`);
    const label = decodeURIComponent((/ical\/([^/]+)\//.exec(u) || [])[1] || 'calendar');
    const evs = parseICS(await r.text(), label); feeds.push(evs); names.push(evs[0] ? evs[0].cal : label);
  }
  const p = parts(now, tz), today = Date.UTC(p.y, p.mo - 1, p.d);
  const fromD = new Date(today - pastDays * 864e5), toD = new Date(today + futureDays * 864e5);
  const iso = t => t.toISOString().slice(0, 10);
  const events = buildEvents(feeds, today - (pastDays + 1) * 864e5, today + (futureDays + 1) * 864e5);
  const md = renderMd(events, { tz, calendars: names, from: iso(fromD), to: iso(toD), now });
  const body = s => s.replace(/^- \*\*Export Time:\*\*.*$/m, '');
  let old = ''; try { old = fs.readFileSync(outFile, 'utf8'); } catch { }
  if (body(old) === body(md)) return { changed: false, count: events.length };
  const tmp = outFile + '.tmp-' + process.pid; fs.writeFileSync(tmp, md); fs.renameSync(tmp, outFile);
  return { changed: true, count: events.length };
}
module.exports = { parseICS, buildEvents, renderMd, syncCalendars, expand };
