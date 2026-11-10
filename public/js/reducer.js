/* Quest Log — shared state logic. Runs in the browser (demo mode) and in Node (server).
 * State shape:
 *   lines:  [{id, short, name, prio, blurb, boss:{name,date,note}|null, steps:[Step]}]
 *   Step:   {id, title, status:'todo'|'doing'|'done', priority:'high'|'normal'|'low',
 *            planned?, due?, note?, checkpoint?, subs:[{id,t,done,doneAt?}], comments:[{at,text}], doneAt?}
 *   player: {xp, streak, lastActive, history:[{at,kind,line,step,title,xp,comment}]}
 *   focus:  [{line, step}]          (today's quests, max 3)
 *   events: [{id,date,start,end,allDay,title,line}]
 *   inbox:  [{id,t,at}]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuestReducer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const XP = { high: 50, normal: 30, low: 15 };
  const SUB_XP = 10, LEVEL_XP = 250, FOCUS_MAX = 3;

  const clone = o => JSON.parse(JSON.stringify(o));
  const rid = p => p + '-' + Math.random().toString(36).slice(2, 8);
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

  function level(xp) { return 1 + Math.floor(xp / LEVEL_XP); }
  function deadlineOf(s) { return s.due ? { date: s.due, kind: 'due' } : s.planned ? { date: s.planned, kind: 'plan' } : null; }
  function urgency(s, today) {
    if (s.status === 'done') return null;
    const d = deadlineOf(s); if (!d) return null;
    const n = dayDiff(today, d.date);
    return { days: n, kind: d.kind, date: d.date, level: n < 0 ? 'late' : n <= 3 ? 'crit' : n <= 7 ? 'warn' : 'ok' };
  }
  // A sub-line has parent = id of a top-level line. Order: each top-level line followed by its sub-lines.
  function ordered(lines) {
    const tops = lines.filter(l => !l.parent || !lines.some(p => p.id === l.parent));
    const out = []; tops.forEach(t => { out.push(t); lines.forEach(c => { if (c.parent === t.id) out.push(c); }); });
    return out;
  }
  function setParent(st, l, pid) {
    pid = clean(pid, 12).toUpperCase();
    if (!pid) { delete l.parent; return; }
    if (pid === l.id) throw new Error('A line cannot be its own parent');
    const p = findLine(st, pid); if (p.parent) throw new Error('Sub-lines can only go one level deep');
    if (st.lines.some(x => x.parent === l.id)) throw new Error(l.id + ' has sub-lines, so it cannot become a sub-line');
    l.parent = p.id;
  }
  function frontier(line) { const i = line.steps.findIndex(s => s.status !== 'done'); return i < 0 ? line.steps.length : i; }
  function findLine(st, id) { const l = st.lines.find(x => x.id === id); if (!l) throw new Error('Unknown mission line ' + id); return l; }
  function findStep(l, id) { const s = l.steps.find(x => x.id === id); if (!s) throw new Error('Unknown step ' + id); return s; }
  function nextTaskId(st, today) {
    const p = 'T-' + today.replace(/-/g, '') + '-';
    let n = 0; st.lines.forEach(l => l.steps.forEach(s => { if (s.id && s.id.startsWith(p)) n = Math.max(n, +s.id.slice(p.length) || 0); }));
    (st.knownIds || []).forEach(id => { if (id.startsWith(p)) n = Math.max(n, +id.slice(p.length) || 0); });
    return p + String(n + 1).padStart(2, '0');
  }
  function touchStreak(p, today) {
    if (p.lastActive === today) return;
    p.streak = p.lastActive && dayDiff(p.lastActive, today) === 1 ? (p.streak || 0) + 1 : 1;
    p.lastActive = today;
  }
  function award(st, ctx, entry) {
    const p = st.player; p.xp = Math.max(0, (p.xp || 0) + entry.xp);
    if (entry.xp > 0) touchStreak(p, ctx.today);
    p.history = [{ at: ctx.now, ...entry }, ...(p.history || [])].slice(0, 400);
  }
  const clean = (v, max = 300) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  const okDate = v => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const okTime = v => (v && /^\d{2}:\d{2}$/.test(v) ? v : undefined);
  const okPrio = v => (['high', 'normal', 'low'].includes(v) ? v : 'normal');

  /* apply(state, action, ctx) -> {state, msg, xp}
   * ctx = {today:'YYYY-MM-DD', now: ISO string} */
  function apply(state0, a, ctx) {
    const st = clone(state0); let msg = '', xp = 0;
    st.player = st.player || { xp: 0, streak: 0, history: [] };
    st.focus = st.focus || []; st.events = st.events || []; st.inbox = st.inbox || [];
    switch (a.type) {
      case 'complete_step': {
        const l = findLine(st, a.line), s = findStep(l, a.step);
        if (s.status === 'done') break;
        s.status = 'done'; s.doneAt = ctx.now;
        const c = clean(a.comment, 2000); if (c) (s.comments = s.comments || []).push({ at: ctx.now, text: c });
        xp = XP[s.priority] || 30;
        award(st, ctx, { kind: 'step', line: l.id, step: s.id, title: s.title, xp, comment: c || undefined });
        st.focus = st.focus.filter(f => !(f.line === l.id && f.step === s.id));
        msg = `quest(${l.id}): complete ${s.id} "${s.title}" +${xp}xp`;
        break;
      }
      case 'reopen_step': {
        const l = findLine(st, a.line), s = findStep(l, a.step);
        if (s.status !== 'done') break;
        s.status = 'todo'; delete s.doneAt; xp = -(XP[s.priority] || 30);
        award(st, ctx, { kind: 'reopen', line: l.id, step: s.id, title: s.title, xp });
        msg = `quest(${l.id}): reopen ${s.id}`;
        break;
      }
      case 'add_step': {
        const l = findLine(st, a.line), title = clean(a.title); if (!title) throw new Error('Title is required');
        const s = { id: nextTaskId(st, ctx.today), title, status: 'todo', priority: okPrio(a.priority), subs: [], comments: [] };
        if (okDate(a.planned)) s.planned = a.planned; if (okDate(a.due)) s.due = a.due; if (clean(a.note)) s.note = clean(a.note, 2000);
        if (a.position === 'next') l.steps.splice(frontier(l) + 1, 0, s); else l.steps.push(s);
        (st.knownIds = st.knownIds || []).push(s.id);
        if (a.today && st.focus.length < FOCUS_MAX) st.focus.push({ line: l.id, step: s.id });
        msg = `quest(${l.id}): add ${s.id} "${title}"`;
        break;
      }
      case 'edit_step': {
        const l = findLine(st, a.line), s = findStep(l, a.step);
        if (a.title != null && clean(a.title)) s.title = clean(a.title);
        if (a.priority) s.priority = okPrio(a.priority);
        ['planned', 'due'].forEach(k => { if (k in a) { if (okDate(a[k])) s[k] = a[k]; else delete s[k]; } });
        if ('note' in a) { const n = clean(a.note, 2000); if (n) s.note = n; else delete s.note; }
        if (a.status === 'doing' || a.status === 'todo') { if (s.status !== 'done') s.status = a.status; }
        if (typeof a.move === 'number') { const i = l.steps.indexOf(s), j = Math.max(0, Math.min(l.steps.length - 1, i + a.move)); l.steps.splice(i, 1); l.steps.splice(j, 0, s); }
        msg = `quest(${l.id}): edit ${s.id}`;
        break;
      }
      case 'delete_step': {
        const l = findLine(st, a.line), s = findStep(l, a.step);
        l.steps = l.steps.filter(x => x !== s); st.focus = st.focus.filter(f => !(f.line === l.id && f.step === s.id));
        msg = `quest(${l.id}): delete ${s.id} "${s.title}"`;
        break;
      }
      case 'toggle_sub': {
        const l = findLine(st, a.line), s = findStep(l, a.step), u = (s.subs || []).find(x => x.id === a.sub);
        if (!u) throw new Error('Unknown subtask');
        u.done = !u.done; if (u.done) u.doneAt = ctx.now; else delete u.doneAt;
        xp = u.done ? SUB_XP : -SUB_XP;
        award(st, ctx, { kind: 'sub', line: l.id, step: s.id, title: u.t, xp });
        msg = `quest(${l.id}): ${u.done ? 'check' : 'uncheck'} "${u.t}" (${s.id})`;
        break;
      }
      case 'add_sub': {
        const l = findLine(st, a.line), s = findStep(l, a.step), t = clean(a.t); if (!t) throw new Error('Subtask text is required');
        (s.subs = s.subs || []).push({ id: rid('s'), t, done: false });
        msg = `quest(${l.id}): add subtask "${t}" (${s.id})`;
        break;
      }
      case 'delete_sub': {
        const l = findLine(st, a.line), s = findStep(l, a.step);
        s.subs = (s.subs || []).filter(x => x.id !== a.sub); msg = `quest(${l.id}): delete subtask (${s.id})`;
        break;
      }
      case 'comment_step': {
        const l = findLine(st, a.line), s = findStep(l, a.step), c = clean(a.text, 2000); if (!c) break;
        (s.comments = s.comments || []).push({ at: ctx.now, text: c }); msg = `quest(${l.id}): comment on ${s.id}`;
        break;
      }
      case 'focus_add': {
        const l = findLine(st, a.line), s = findStep(l, a.step);
        if (st.focus.some(f => f.line === l.id && f.step === s.id)) break;
        if (st.focus.length >= FOCUS_MAX) throw new Error(`Today already has ${FOCUS_MAX} quests — finish or drop one first`);
        st.focus.push({ line: l.id, step: s.id }); msg = `today: add ${s.id} "${s.title}"`;
        break;
      }
      case 'focus_remove': {
        st.focus = st.focus.filter(f => !(f.line === a.line && f.step === a.step)); msg = `today: drop ${a.step}`;
        break;
      }
      case 'add_line': {
        const short = clean(a.short, 8).toUpperCase(), name = clean(a.name, 80); if (!short || !name) throw new Error('Name and short code are required');
        let id = clean(a.id, 12).toUpperCase(); if (!id) { let n = 1; st.lines.forEach(x => { const m = /^JL-(\d+)$/.exec(x.id); if (m) n = Math.max(n, +m[1] + 1); }); id = 'JL-' + String(n).padStart(2, '0'); }
        if (st.lines.some(x => x.id === id)) throw new Error('Line id already exists');
        const line = { id, short, name, prio: okPrio(a.prio), blurb: clean(a.blurb, 300), boss: null, steps: [] };
        if (clean(a.bossName) && okDate(a.bossDate)) line.boss = { name: clean(a.bossName, 60), date: a.bossDate, note: clean(a.bossNote, 120) };
        if (a.parent) setParent(st, line, a.parent);
        st.lines.push(line); msg = `quest: new line ${id} "${name}"${line.parent ? ' under ' + line.parent : ''}`;
        break;
      }
      case 'edit_line': {
        const l = findLine(st, a.line);
        if (clean(a.name)) l.name = clean(a.name, 80); if (clean(a.short)) l.short = clean(a.short, 8).toUpperCase();
        if (a.prio) l.prio = okPrio(a.prio); if ('blurb' in a) l.blurb = clean(a.blurb, 300);
        if ('parent' in a) setParent(st, l, a.parent);
        if ('bossName' in a) l.boss = clean(a.bossName) && okDate(a.bossDate) ? { name: clean(a.bossName, 60), date: a.bossDate, note: clean(a.bossNote, 120) } : null;
        if (typeof a.move === 'number') { const i = st.lines.indexOf(l), j = Math.max(0, Math.min(st.lines.length - 1, i + a.move)); st.lines.splice(i, 1); st.lines.splice(j, 0, l); }
        msg = `quest: edit line ${l.id}`;
        break;
      }
      case 'add_event': {
        const title = clean(a.title, 120), date = okDate(a.date); if (!title || !date) throw new Error('Event needs a title and date');
        const e = { id: rid('e'), date, title, allDay: !!a.allDay || !okTime(a.start) };
        if (!e.allDay) { e.start = okTime(a.start); e.end = okTime(a.end) || e.start; }
        if (a.line) e.line = a.line;
        st.events.push(e); msg = `calendar: add "${title}" ${date}${e.start ? ' ' + e.start : ''}`;
        break;
      }
      case 'delete_event': { st.events = st.events.filter(e => e.id !== a.id); msg = 'calendar: delete event'; break; }
      case 'inbox_add': { const t = clean(a.t, 500); if (!t) throw new Error('Empty'); st.inbox.unshift({ id: rid('i'), t, at: ctx.now }); msg = 'inbox: capture'; break; }
      case 'inbox_delete': { st.inbox = st.inbox.filter(x => x.id !== a.id); msg = 'inbox: discard'; break; }
      case 'inbox_promote': {
        const it = st.inbox.find(x => x.id === a.id); if (!it) throw new Error('Unknown inbox item');
        const l = findLine(st, a.line);
        if (a.kind === 'sub') {
          const s = l.steps[Math.min(frontier(l), l.steps.length - 1)]; if (!s) throw new Error('Line has no steps yet');
          (s.subs = s.subs || []).push({ id: rid('s'), t: it.t.slice(0, 300), done: false });
        } else {
          const s = { id: nextTaskId(st, ctx.today), title: it.t.slice(0, 300), status: 'todo', priority: 'normal', subs: [], comments: [] };
          l.steps.push(s); (st.knownIds = st.knownIds || []).push(s.id);
        }
        st.inbox = st.inbox.filter(x => x !== it); msg = `quest(${l.id}): promote inbox item to ${a.kind === 'sub' ? 'subtask' : 'step'}`;
        break;
      }
      default: throw new Error('Unknown action ' + a.type);
    }
    return { state: st, msg, xp };
  }

  return { apply, ordered, XP, SUB_XP, LEVEL_XP, FOCUS_MAX, level, urgency, deadlineOf, frontier, dayDiff };
});
