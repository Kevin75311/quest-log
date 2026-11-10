/* Quest Log front end — vanilla JS, no build step. */
(() => {
  'use strict';
  const R = window.QuestReducer;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEMO = !!window.QL_DEMO;
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const dobj = s => new Date(s + 'T12:00:00Z');
  const md = s => { const d = dobj(s); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  const addDays = (s, n) => { const d = dobj(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const short = id => id.replace(/^JL-/, '').replace(/^SIDE$/, 'SQ');

  let S = null; // {state, calendar, sync, today, now, tz}
  const U = { view: localStorage.getItem('ql.view') || 'map', open: null, stepOpen: {}, showDone: {}, completing: null, bossI: 0, shownXP: null, lateAll: false, cal: null, busy: false };
  try { U.open = localStorage.getItem('ql.open') || null; } catch { }

  /* ================= data / api ================= */
  function todayLocal(tz) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function demoPayload() {
    const D = window.QL_DEMO;
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem('ql.demo') || 'null'); } catch { }
    const state = saved || { lines: D.missions.lines, knownIds: [], player: D.player.player, focus: D.player.focus, events: D.events.events, inbox: D.inbox.inbox };
    return { state, calendar: D.calendar, sync: { state: 'demo' }, today: todayLocal(), now: new Date().toISOString(), tz: 'America/Los_Angeles' };
  }
  async function load() {
    if (DEMO) { S = demoPayload(); return; }
    const r = await fetch('api/state', { credentials: 'same-origin' });
    if (r.status === 401) return login();
    if (!r.ok) throw new Error('Server error ' + r.status);
    S = await r.json();
  }
  async function act(a, quiet) {
    try {
      if (DEMO) {
        const r = R.apply(S.state, a, { today: todayLocal(), now: new Date().toISOString() });
        S.state = r.state; try { sessionStorage.setItem('ql.demo', JSON.stringify(S.state)); } catch { }
        return { xp: r.xp, msg: r.msg };
      }
      const r = await fetch('api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(a) });
      const j = await r.json();
      if (r.status === 401) { login(); return null; }
      if (!r.ok) throw new Error(j.error || 'Request failed');
      const keepXP = U.shownXP; S = j; U.shownXP = keepXP;
      watchSync();
      return j;
    } catch (e) { if (!quiet) toast('HOLD ON', e.message, true); return null; }
  }
  let syncTimer = null;
  function watchSync(n = 0) {
    clearTimeout(syncTimer); if (DEMO) return;
    syncTimer = setTimeout(async () => {
      try { const j = await (await fetch('api/sync')).json(); S.sync = { ...S.sync, ...j.sync }; renderNav(); if (/pending|pushing/.test(S.sync.state) && n < 30) watchSync(n + 1); } catch { }
    }, n ? 2000 : 2500);
  }
  function login() {
    const d = document.createElement('div'); d.className = 'login';
    d.innerHTML = `<form class="card" style="width:min(360px,90vw)"><div class="sticker a">QUEST LOG</div><div class="fld"><label>Passcode</label><input type="password" id="pc" autofocus></div><div class="err" id="pce"></div><button class="btn dark" style="margin-top:12px;width:100%">ENTER</button></form>`;
    document.body.appendChild(d);
    d.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const r = await fetch('api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: $('#pc').value }) });
      if (r.ok) location.reload(); else $('#pce').textContent = 'Wrong passcode';
    };
  }

  /* ================= derived ================= */
  const lines = () => R.ordered(S.state.lines);
  const L = id => lines().find(l => l.id === id);
  const ST = (lid, sid) => { const l = L(lid); return l && l.steps.find(s => s.id === sid); };
  const urg = s => R.urgency(s, S.today);
  const isFocus = (lid, sid) => S.state.focus.some(f => f.line === lid && f.step === sid);
  function urgText(u, long) {
    if (!u) return '';
    if (u.level === 'late') return long ? `${u.kind === 'due' ? 'DUE' : 'PLANNED'} ${md(u.date)} · CHECK-IN` : 'CHECK-IN';
    if (u.days === 0) return 'TODAY';
    if (u.level === 'ok') return md(u.date);
    return `${u.days}D`;
  }
  function allUrgent() {
    const out = [];
    lines().forEach(l => l.steps.forEach(s => { const u = urg(s); if (u) out.push({ l, s, u }); }));
    return out;
  }
  function bosses() {
    return lines().filter(l => l.boss && l.boss.date && R.dayDiff(S.today, l.boss.date) >= 0)
      .map(l => ({ l, ...l.boss, days: R.dayDiff(S.today, l.boss.date) })).sort((a, b) => a.days - b.days);
  }

  /* ================= render ================= */
  function render() {
    if (!S) return;
    renderHeader(); renderNav(); renderView(); renderRail();
  }
  function renderHeader() {
    const p = S.state.player; if (U.shownXP == null) U.shownXP = p.xp;
    const xp = Math.max(0, Math.round(U.shownXP)), lv = R.level(xp), into = xp % R.LEVEL_XP;
    const lvEl = $('#lv'); const lvStr = String(lv).padStart(2, '0');
    if (lvEl.textContent !== lvStr) { lvEl.textContent = lvStr; lvEl.classList.remove('bump'); void lvEl.offsetWidth; lvEl.classList.add('bump'); }
    $('#xpfill').style.width = (into / R.LEVEL_XP * 100) + '%';
    $('#xptxt').textContent = `${into} / ${R.LEVEL_XP} XP`;
    $('#xpnext').textContent = `NEXT · LV ${lv + 1}`;
    $('#streak').textContent = p.streak || 0;
    $('#total').textContent = xp.toLocaleString('en-US');
    const d = dobj(S.today), n = S.state.focus.length;
    $('#date').innerHTML = `${WD[d.getUTCDay()]} · ${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}<small>${n ? n + ' QUEST' + (n > 1 ? 'S' : '') + ' TODAY' : 'ALL CLEAR'}</small>`;
    if (!$('#face').innerHTML) $('#face').innerHTML = `<svg width="62" height="62" viewBox="68 -6 80 80">${giraffeSVG()}</svg>`;
  }
  function renderNav() {
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.go === U.view));
    $('#inboxN').textContent = S.state.inbox.length || '';
    const s = S.sync || {}, el = $('#sync');
    el.className = 'sync ' + (s.state || '');
    const label = { demo: 'DEMO MODE', disabled: 'GIT OFF', idle: 'READY', pending: 'SAVING…', pushing: 'PUSHING…', synced: 'SYNCED', committed: 'COMMITTED (PUSH OFF)', error: 'SYNC ERROR', conflict: 'CONFLICT' }[s.state] || 'SYNC';
    el.querySelector('span').textContent = label;
  }
  function renderView() {
    const v = $('#view');
    if (U.view === 'cal') return renderCal(v);
    if (U.view === 'inbox') return renderInbox(v);
    renderMap(v);
  }

  /* ---------- mission map ---------- */
  function renderMap(v) {
    const pbOld = $('#pb'); const keepTop = pbOld ? pbOld.scrollTop : 0;
    const trailKeep = {}; $$('.trail').forEach(t => trailKeep[t.dataset.trail] = t.scrollLeft);
    const d = dobj(S.today);
    v.innerHTML = `
      <div class="ph"><h2>MISSION <span>NETWORK</span></h2><span class="hint">Click a line to open its steps</span><div class="sp"></div>
        <span class="tag"><i style="background:var(--red)"></i>≤3 DAYS</span><span class="tag"><i style="background:var(--hi)"></i>≤7 DAYS</span><span class="tag"><i style="background:var(--ink);color:var(--paper)">?</i>CHECK-IN</span>
        <button class="btn sm" data-act="newline">+ LINE</button></div>
      <div class="pb" id="pb"><div class="net" id="net"><svg class="trunks" id="trunks"></svg>
        <div class="hub" id="hub">NOW<small>${WD[d.getUTCDay()]} ${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}</small></div>
        ${lines().map(rowHTML).join('')}</div></div>`;
    $('#pb').scrollTop = keepTop;
    $$('.trail').forEach(t => { if (trailKeep[t.dataset.trail] != null) t.scrollLeft = trailKeep[t.dataset.trail]; else focusTrail(t); dragScroll(t, 'x'); });
    drawTrunks();
  }
  function rowHTML(l) {
    const f = R.frontier(l), cur = l.steps[f], open = U.open === l.id;
    const done = l.steps.filter(s => s.status === 'done').length;
    const mini = l.steps.map((s, i) => `${i ? `<b class="${i <= f ? '' : 'dot'}"></b>` : ''}<i class="${s.status === 'done' ? 'd' : i === f ? 'c' : ''}"></i>`).join('');
    let pill = '';
    if (cur) {
      const u = urg(cur); const lv = u ? u.level : '';
      const tag = !u ? '' : lv === 'late' ? '<span class="qi">?</span>' : `<span class="d">${urgText(u)}</span>`;
      pill = `<button class="cur ${lv}" data-goto="${l.id}|${cur.id}" title="${esc(cur.title)}${u ? ' — ' + urgText(u, true) : ''}">${tag}<span class="tx">${esc(cur.title)}</span></button>`;
    } else pill = `<span class="cur">ALL STEPS CLEARED ✓</span>`;
    const boss = l.boss && R.dayDiff(S.today, l.boss.date) >= 0 ? `<span class="bt">${esc(l.boss.name)} <b>${R.dayDiff(S.today, l.boss.date)}D</b></span>` : '';
    return `<div class="row ${l.prio === 'low' ? 'low' : ''} ${open ? 'open' : ''} ${l.parent ? 'subl' : ''}" data-line="${l.id}" ${l.parent ? `data-parent="${l.parent}"` : ''}>
      <div class="rhead"><button class="chip" data-toggle="${l.id}" title="${esc(l.name)}"><span class="id">${short(l.id)}</span><span class="nm">${esc(l.short)}</span><span class="ct">${done}/${l.steps.length}</span>
        <svg class="car" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <div class="mini">${mini}</div>${pill}${boss}</div>
      ${open ? `<div class="exp" data-exp="${l.id}">${expHTML(l)}</div>` : ''}</div>`;
  }
  function expHTML(l) {
    const f = R.frontier(l);
    const stations = l.steps.map((s, i) => {
      const u = urg(s), cls = s.status === 'done' ? 'done' : i === f ? 'now' : '';
      const when = u ? `<span class="when ${u.level}">${u.level === 'late' ? '? ' + md(u.date) : urgText(u)}</span>` : '';
      return `<div class="stn ${cls}" data-jump="${l.id}|${s.id}" title="${esc(s.title)}"><div class="seg ${s.status === 'done' ? 'solid' : 'dots'}"></div><div class="o"></div><div class="t">${esc(s.title)}</div>${when}</div>`;
    }).join('');
    const nDone = l.steps.filter(s => s.status === 'done').length, showDone = U.showDone[l.id];
    const steps = l.steps.map((s, i) => (s.status === 'done' && !showDone) ? '' : stepHTML(l, s, i === f)).join('');
    const b = l.boss;
    return `<div class="exp-in">
      <div class="exp-top"><div><h3>${esc(l.name)}</h3>${l.blurb ? `<p>${esc(l.blurb)}</p>` : ''}
        ${b ? `<div class="meta" style="margin-top:8px;display:flex;gap:6px"><span class="chipx hi">BOSS · ${esc(b.name)} · ${md(b.date)}</span>${b.note ? `<span class="chipx id">${esc(b.note)}</span>` : ''}</div>` : ''}</div>
        <div class="acts"><button class="btn sm acc" data-act="addstep" data-line="${l.id}">+ STEP</button><button class="btn sm" data-act="editline" data-line="${l.id}">EDIT LINE</button><button class="btn sm ghost" data-toggle="${l.id}">CLOSE ✕</button></div></div>
      <div class="trail" data-trail="${l.id}">${stations || '<div class="calnote" style="padding:10px">No steps yet — add the first one.</div>'}</div>
      <div class="steps">
        ${nDone ? `<button class="more" data-showdone="${l.id}">${showDone ? '▾ HIDE' : '▸ SHOW'} ${nDone} CLEARED STEP${nDone > 1 ? 'S' : ''}</button>` : ''}
        ${steps}
        <div class="addrow" style="margin-top:12px"><input class="inp" data-addstep="${l.id}" placeholder="Add a main step to ${esc(l.short)} and press Enter…"></div>
      </div></div>`;
  }
  function stepHTML(l, s, isNow) {
    const key = l.id + '|' + s.id, done = s.status === 'done', u = urg(s);
    const open = U.stepOpen[key] != null ? U.stepOpen[key] : (isNow && !done);
    const subs = s.subs || [], sd = subs.filter(x => x.done).length;
    const chips = [
      `<span class="chipx id">${s.checkpoint ? 'CHECKPOINT' : esc(s.id)}</span>`,
      s.priority === 'high' ? '<span class="chipx hi">HIGH</span>' : s.priority === 'low' ? '<span class="chipx lo">LOW</span>' : '',
      s.status === 'doing' ? '<span class="chipx doing">DOING</span>' : '',
      u ? `<span class="chipx ${u.level}">${u.kind === 'due' ? 'DUE' : 'PLAN'} ${md(u.date)}${u.level !== 'late' && u.level !== 'ok' ? ' · ' + urgText(u) : u.level === 'late' ? ' · CHECK-IN' : ''}</span>` : (done && s.doneAt ? `<span class="chipx id">DONE ${md(s.doneAt.slice(0, 10))}</span>` : ''),
      subs.length ? `<span class="chipx id">${sd}/${subs.length} SUB</span>` : '',
      (s.comments || []).length ? `<span class="chipx id">💬 ${(s.comments || []).length}</span>` : '',
    ].join('');
    const completing = U.completing && U.completing.key === key && U.completing.where === 'line';
    return `<div class="st ${done ? 'done' : ''} ${isNow ? 'now' : ''}" id="st-${cssId(key)}">
      <div class="sr"><button class="cb ${done ? 'done' : ''}" data-complete="${key}" data-where="line" title="${done ? 'Reopen' : 'Complete with a comment'}"></button>
        <div class="tt" data-expand="${key}"><b>${esc(s.title)}</b><div class="meta">${chips}</div></div>
        ${!done ? `<button class="ic ${isFocus(l.id, s.id) ? 'on' : ''}" data-focus="${key}" title="${isFocus(l.id, s.id) ? 'In today — click to drop' : 'Add to today'}">★</button>` : ''}
        <button class="ic" data-edit="${key}" title="Edit step"><svg viewBox="0 0 16 16"><path d="M3 11.5V13h1.5l7-7L10 4.5zM11 3.5l1.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button></div>
      ${completing ? cformHTML(l, s) : ''}
      ${open ? `<div class="sbody">
        ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
        ${subs.map(x => `<div class="sub ${x.done ? 'dn' : ''}"><button class="cb s ${x.done ? 'on' : ''}" data-sub="${key}|${x.id}"></button><span>${esc(x.t)}</span><button class="x" data-delsub="${key}|${x.id}" title="Delete subtask">✕</button></div>`).join('')}
        ${!done ? `<div class="addrow"><input class="inp" data-addsub="${key}" placeholder="Add a subtask and press Enter…"></div>` : ''}
        ${(s.comments || []).map(c => `<div class="cmt">${esc(c.text)}<small>${c.at.slice(0, 10)}</small></div>`).join('')}
        <div class="addrow"><input class="inp" data-comment="${key}" placeholder="Add a progress note and press Enter…" style="border-style:dashed"></div>
      </div>` : ''}
    </div>`;
  }
  const cssId = k => k.replace(/[^a-zA-Z0-9]/g, '_');
  function cformHTML(l, s) {
    return `<div class="cform"><div class="cform-in"><textarea data-cmt placeholder="Comment (optional): what got done, anything for next time…"></textarea>
      <div class="row2"><button class="btn acc" data-submit="${l.id}|${s.id}" title="Ctrl+Enter">SUBMIT · +${R.XP[s.priority] || 30} XP</button><button class="btn ghost" data-cancel>CANCEL</button></div></div></div>`;
  }
  function focusTrail(t) {
    const st = [...t.querySelectorAll('.stn')], i = st.findIndex(x => x.classList.contains('now'));
    if (i > 0) t.scrollLeft = (i - 1) * 168 + 18;
  }
  function drawTrunks() {
    const net = $('#net'), svg = $('#trunks'); if (!net || !svg || getComputedStyle(svg).display === 'none') return;
    const nr = net.getBoundingClientRect();
    const all = $$('.row', net).map(r => { const c = $('.chip', r).getBoundingClientRect(); return { id: r.dataset.line, parent: r.dataset.parent, y: c.top - nr.top + c.height / 2, x: c.left - nr.left, top: c.top - nr.top, bot: c.bottom - nr.top, low: r.classList.contains('low'), open: r.classList.contains('open') }; });
    const rows = all.filter(r => !r.parent), subs = all.filter(r => r.parent);
    if (!rows.length) return;
    const hubY = (rows[0].y + rows[rows.length - 1].y) / 2; $('#hub').style.top = hubY + 'px';
    const above = rows.filter(r => r.y < hubY - 1), below = rows.filter(r => r.y > hubY + 1);
    svg.setAttribute('width', nr.width); svg.setAttribute('height', net.scrollHeight);
    let p = '';
    rows.forEach((r, i) => {
      const o = (i - (rows.length - 1) / 2) * 5;
      let sx; const ai = above.indexOf(r), bi = below.indexOf(r);
      if (ai >= 0) sx = 124 + ai * 9; else if (bi >= 0) sx = 124 + (below.length - 1 - bi) * 9; else sx = null;
      const col = r.open ? 'var(--acc)' : r.low ? 'var(--grey)' : 'var(--ink)';
      const d = sx == null ? `M74 ${r.y} L${r.x} ${r.y}` : `M74 ${hubY + o} L${sx} ${hubY + o} L${sx} ${r.y} L${r.x} ${r.y}`;
      p += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${r.open ? 6 : r.low ? 3 : 4.5}" stroke-linejoin="round" ${r.open ? 'style="paint-order:stroke"' : ''}/>`;
    });
    subs.forEach(r => { // sub-line: elbow from its parent chip
      const par = rows.find(x => x.id === r.parent); if (!par) return;
      const px = par.x + 22, col = r.open ? 'var(--acc)' : r.low ? 'var(--grey)' : 'var(--ink)';
      p += `<path d="M${px} ${par.bot} L${px} ${r.y} L${r.x} ${r.y}" fill="none" stroke="${col}" stroke-width="${r.open ? 5 : 3.5}" stroke-linejoin="round"/>`;
    });
    svg.innerHTML = p;
  }
  function animateTrunks(ms = 450) { const t0 = performance.now(); const f = t => { drawTrunks(); if (t - t0 < ms) requestAnimationFrame(f); }; requestAnimationFrame(f); }
  function toggleLine(id) {
    const prev = U.open; U.open = prev === id ? null : id;
    try { localStorage.setItem('ql.open', U.open || ''); } catch { }
    if (prev) { const e = $(`.exp[data-exp="${prev}"]`); if (e) { const h = e.offsetHeight; e.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 250, easing: 'ease-in' }); } }
    setTimeout(() => {
      renderMap($('#view'));
      const e = U.open && $(`.exp[data-exp="${U.open}"]`);
      if (e) {
        const h = e.offsetHeight; e.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.3,1.2,.5,1)' });
        const pb = $('#pb'), row = e.closest('.row'); setTimeout(() => pb.scrollTo({ top: Math.max(0, row.offsetTop - 10), behavior: 'smooth' }), 60);
      }
      animateTrunks(520);
    }, prev ? 200 : 0);
  }
  function gotoStep(lid, sid) {
    U.view = 'map'; U.open = lid; if (sid) { U.stepOpen[lid + '|' + sid] = true; const s = ST(lid, sid); if (s && s.status === 'done') U.showDone[lid] = true; }
    try { localStorage.setItem('ql.view', 'map'); localStorage.setItem('ql.open', lid); } catch { }
    render();
    requestAnimationFrame(() => {
      const el = sid && document.getElementById('st-' + cssId(lid + '|' + sid)), pb = $('#pb');
      if (el && pb) { pb.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - pb.getBoundingClientRect().top + pb.scrollTop - 120), behavior: 'smooth' }); el.classList.add('flash'); }
      else { const row = $(`.row[data-line="${lid}"]`); if (row && pb) pb.scrollTo({ top: row.offsetTop - 10, behavior: 'smooth' }); }
    });
  }

  /* ---------- rail ---------- */
  function renderRail() {
    const all = allUrgent();
    const soon = all.filter(x => x.u.level === 'crit' || x.u.level === 'warn').sort((a, b) => a.u.days - b.u.days);
    const late = all.filter(x => x.u.level === 'late').sort((a, b) => b.u.days - a.u.days);
    const cap = U.soonAll ? soon.length : Math.min(U.soonCap || 4, 4);
    const soonShown = soon.slice(0, cap);
    $('#urg').innerHTML = (soon.length ? soonShown.map(({ l, s, u }) => `<button class="u" data-goto="${l.id}|${s.id}"><div class="cd ${u.level}">${u.days}<small>${u.days === 1 ? 'DAY' : 'DAYS'}</small></div><div class="ut"><span class="tl">${esc(s.title)}</span><small>${short(l.id)} · ${esc(l.short)} · ${u.kind === 'due' ? 'DUE' : 'PLANNED'} ${md(u.date)}</small></div></button>`).join('')
        + (soon.length > cap || U.soonAll ? `<button class="more" data-soonall>${U.soonAll ? '▾ LESS' : `▸ ${soon.length - cap} MORE`}</button>` : '')
      : '<div class="calnote" style="padding:6px 0">Nothing due in the next 7 days.</div>')
      + (late.length ? `<button class="late-h" data-lateall><span class="qi">?</span>${late.length} NEED A CHECK-IN<span class="sp"></span>${U.lateAll ? '▾' : '▸'}</button>`
        + (U.lateAll ? late.map(({ l, s, u }) => `<button class="late-i" data-goto="${l.id}|${s.id}"><i>?</i><span>${esc(s.title)}</span><small>${md(u.date)}</small></button>`).join('') : '') : '');
    // today
    const F = S.state.focus.map(f => ({ f, l: L(f.line), s: ST(f.line, f.step) })).filter(x => x.l && x.s);
    let h = F.map(({ l, s }) => {
      const key = l.id + '|' + s.id, u = urg(s), comp = U.completing && U.completing.key === key && U.completing.where === 'today';
      const sub = (s.subs || []).length ? ` · ${(s.subs || []).filter(x => x.done).length}/${s.subs.length}` : '';
      return `<div class="q" data-q="${key}"><div class="qr"><button class="cb ${comp ? 'on' : ''}" data-complete="${key}" data-where="today" title="Complete"></button>
        <button class="qt" data-goto="${key}"><span class="tl">${esc(s.title)}</span><small>${short(l.id)} · ${esc(l.short)}${sub}${u ? ` · <span style="color:${u.level === 'crit' ? 'var(--red)' : u.level === 'late' ? 'var(--ink)' : 'inherit'}">${urgText(u, true)}</span>` : ''}</small></button>
        <span class="xpc">+${R.XP[s.priority] || 30}</span><button class="drop" data-unfocus="${key}" title="Drop from today">✕</button></div>${comp ? cformHTML(l, s) : ''}</div>`;
    }).join('');
    if (!F.length) h = `<div class="clear"><svg width="70" height="80" viewBox="20 0 130 200"><g class="hop">${giraffeSVG('happy')}</g></svg><div><b>ALL CLEAR!</b><span class="calnote">Pick the next quests from the map.</span></div></div>`;
    if (F.length < R.FOCUS_MAX) h += `<button class="pick" data-act="pick">+ PICK A QUEST</button>`;
    $('#today').innerHTML = h;
    renderBosses();
    fitRail();
  }
  // Keep the right column on one screen: show fewer urgent items (the rest go behind "MORE") until it fits.
  function fitRail() {
    const rail = $('.rail'); if (!rail || U.fitting) return;
    rail.classList.remove('tight');
    if (U.soonAll || matchMedia('(max-width:820px)').matches) return;
    const over = () => rail.scrollHeight - rail.clientHeight > 1;
    U.fitting = true;
    try {
      while (over() && (U.soonCap || 4) > 1) { U.soonCap = (U.soonCap || 4) - 1; renderRail(); }
      if (over()) rail.classList.add('tight'); // short screens: compact spacing as a last step
    } finally { U.fitting = false; }
  }
  function renderBosses() {
    const B = bosses(), el = $('#bosses');
    if (!B.length) { el.innerHTML = `<div class="boss b0"><div class="top"><div><small>NO BOSS SCHEDULED</small><div class="bn">ADD A BOSS DATE TO A LINE</div></div></div></div>`; return; }
    U.bossI = U.bossI % B.length;
    const order = [...B.slice(U.bossI), ...B.slice(0, U.bossI)].slice(0, 1);
    el.innerHTML = order.map((b, k) => {
      const total = b.l.steps.length, left = b.l.steps.filter(s => s.status !== 'done').length;
      return `<div class="boss b${k}" style="z-index:${3 - k}"><div class="top"><svg width="38" height="38" viewBox="0 0 44 44"><path d="M22 4C11 4 5 11 5 20c0 6 3 9 6 11v6h22v-6c3-2 6-5 6-11 0-9-6-16-17-16z" fill="#fffaf0"/><circle cx="15" cy="21" r="5" fill="#16130f"/><circle cx="29" cy="21" r="5" fill="#16130f"/><path d="M18 37v-5M22 37v-5M26 37v-5" stroke="#16130f" stroke-width="2.5"/></svg>
        <div><small>BOSS ${(U.bossI + k) % B.length + 1}/${B.length} · ${short(b.l.id)} ${esc(b.l.short)}</small><div class="bn">${esc(b.name)}</div></div><div class="dd"><b>${b.days}</b><small>DAYS</small></div></div>
        <div class="hp">HP<div><i style="width:${total ? left / total * 100 : 0}%"></i></div>${left}/${total}</div>
        <div class="hp" style="margin-top:-2px"><span>${md(b.date)}${b.note ? ' · ' + esc(b.note).slice(0, 34) : ''}</span><span class="dots">${B.map((_, j) => `<i class="${j === U.bossI ? 'on' : ''}"></i>`).join('')}</span></div></div>`;
    }).join('');
  }
  function nextBoss() {
    const B = bosses(); if (B.length < 2) { const t = $('.boss.b0'); t && t.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(3deg)' }, { transform: 'rotate(0)' }], 350); return; }
    const top = $('.boss.b0'); top.classList.add('out');
    setTimeout(() => { U.bossI = (U.bossI + 1) % B.length; renderBosses(); const n = $('.boss.b0'); n.animate([{ transform: 'translateY(10px) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.3,1.4,.5,1)' }); }, 230);
  }

  /* ---------- completion + XP flow ---------- */
  function openComplete(key, where) {
    const [lid, sid] = key.split('|'), s = ST(lid, sid); if (!s) return;
    if (s.status === 'done') return confirmBox('REOPEN STEP?', `“${esc(s.title)}” goes back to the to-do list and −${R.XP[s.priority] || 30} XP.`, 'REOPEN', async () => { const r = await act({ type: 'reopen_step', line: lid, step: sid }); if (r) { U.shownXP = S.state.player.xp; render(); } });
    U.completing = U.completing && U.completing.key === key && U.completing.where === where ? null : { key, where };
    where === 'today' ? renderRail() : renderMap($('#view'));
    const host = where === 'today' ? $(`.q[data-q="${CSS.escape(key)}"]`) : document.getElementById('st-' + cssId(key));
    const f = host && $('.cform', host);
    if (f) { f.animate([{ height: '0px', opacity: 0 }, { height: f.offsetHeight + 'px', opacity: 1 }], { duration: 260, easing: 'ease-out' }); setTimeout(() => $('textarea', f).focus(), 50); }
  }
  async function submitComplete(key, btn) {
    if (U.busy) return; U.busy = true;
    const [lid, sid] = key.split('|'), host = btn.closest('.q, .st'), comment = $('textarea', host).value;
    const cb = $('.cb', host).getBoundingClientRect(), from = { x: cb.left + cb.width / 2, y: cb.top + cb.height / 2 };
    const oldXP = U.shownXP;
    $('.cb', host).classList.add('on');
    const vanish = host.classList.contains('q') ? host.animate([{ opacity: 1, transform: 'none', height: host.offsetHeight + 'px' }, { opacity: 0, transform: 'translateX(40px)', height: '0px', paddingTop: '0px', paddingBottom: '0px' }], { duration: 480, delay: 120, easing: 'ease-in', fill: 'forwards' }).finished : Promise.resolve();
    const r = await act({ type: 'complete_step', line: lid, step: sid, comment });
    await vanish; U.busy = false;
    if (!r) { render(); return; }
    U.completing = null; U.shownXP = oldXP; render();
    const s = ST(lid, sid); toast(`QUEST CLEARED · +${r.xp} XP`, esc(s ? s.title : ''));
    flyXP(from, r.xp, oldXP, S.state.player.xp);
  }
  function flyXP(from, amount, oldXP, newXP) {
    if (!(amount > 0)) { U.shownXP = newXP; renderHeader(); return; }
    const fx = $('#fx'), bar = $('#xpbar').getBoundingClientRect();
    const fill = $('#xpfill').getBoundingClientRect();
    const to = { x: Math.min(bar.right - 14, Math.max(bar.left + 14, fill.right)), y: bar.top + bar.height / 2 };
    const plus = document.createElement('div'); plus.className = 'plus'; plus.textContent = '+' + amount; plus.style.left = (from.x + 14) + 'px'; plus.style.top = (from.y - 30) + 'px'; fx.appendChild(plus);
    plus.animate([{ transform: 'translateY(10px) scale(.6)', opacity: 0 }, { transform: 'translateY(-10px) scale(1.15)', opacity: 1, offset: .3 }, { transform: 'translateY(-40px)', opacity: 0 }], { duration: 1100, easing: 'ease-out' }).finished.then(() => plus.remove());
    const n = Math.max(6, Math.min(14, Math.round(amount / 4)));
    let landed = 0;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('div'); c.className = 'coin'; c.textContent = 'XP'; fx.appendChild(c);
      const mx = (from.x + to.x) / 2 + (Math.random() - .5) * 260, my = Math.min(from.y, to.y) - 60 - Math.random() * 120;
      const a = c.animate([
        { transform: `translate(${from.x}px,${from.y}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${from.x + (Math.random() - .5) * 60}px,${from.y - 20 - Math.random() * 30}px) scale(1.1)`, opacity: 1, offset: .15 },
        { transform: `translate(${mx}px,${my}px) scale(1)`, opacity: 1, offset: .55 },
        { transform: `translate(${to.x}px,${to.y}px) scale(.5)`, opacity: .9 }],
        { duration: 900 + i * 25, delay: i * 55, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' });
      a.finished.then(() => {
        c.remove(); landed++;
        const xb = $('#xpbar'); xb.classList.add('glow'); clearTimeout(xb._t); xb._t = setTimeout(() => xb.classList.remove('glow'), 250);
        U.shownXP = oldXP + (newXP - oldXP) * landed / n; renderHeader();
        if (landed === n) { U.shownXP = newXP; renderHeader(); if (R.level(newXP) > R.level(oldXP)) levelUp(R.level(newXP)); }
      });
    }
  }
  function levelUp(lv) {
    const el = $('#lvup');
    el.innerHTML = `<div class="box"><svg width="170" height="210" viewBox="0 0 150 200"><g class="hop">${giraffeSVG('happy')}</g></svg><b>LEVEL ${lv}!</b></div>`;
    el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 2300);
  }

  /* ---------- calendar ---------- */
  const CAL = { colW: 156, h0: 6, h1: 24, hh: 44, back: 7, fwd: 180 };
  function renderCal(v) {
    const keep = U.cal;
    const start = addDays(S.today, -CAL.back), N = CAL.back + CAL.fwd;
    const days = [...Array(N)].map((_, i) => addDays(start, i));
    const g = (S.calendar && S.calendar.events) || [], mine = S.state.events || [];
    const dls = []; lines().forEach(l => l.steps.forEach(s => { const d = R.deadlineOf(s); if (d && s.status !== 'done') dls.push({ l, s, d, u: urg(s) }); }));
    const W = CAL.colW, H = (CAL.h1 - CAL.h0) * CAL.hh;
    const toY = t => { const [h, m] = t.split(':').map(Number); return (h - CAL.h0 + m / 60) * CAL.hh; };
    const head = days.map(d => { const o = dobj(d), wk = o.getUTCDay() === 1, rel = R.dayDiff(S.today, d); return `<div class="dh ${d === S.today ? 'today' : ''} ${wk ? 'wk' : ''} ${rel < 0 ? 'past' : ''}" style="width:${W}px">${WD[o.getUTCDay()]}${d === S.today ? ' · TODAY' : ''}<b>${MON[o.getUTCMonth()]} ${o.getUTCDate()}</b></div>`; }).join('');
    const allday = days.map(d => {
      const items = [
        ...g.filter(e => e.date === d && e.allDay).map(e => `<button class="ad g" data-gev="${esc(JSON.stringify(e))}">${esc(e.title)}</button>`),
        ...mine.filter(e => e.date === d && e.allDay).map(e => `<button class="ad" style="background:var(--hi)" data-mev="${e.id}">${esc(e.title)}</button>`),
        ...dls.filter(x => x.d.date === d).map(x => `<button class="ad dl ${x.d.kind} ${x.u ? x.u.level : ''}" data-goto="${x.l.id}|${x.s.id}" title="${x.d.kind === 'due' ? 'Due' : 'Planned'}: ${esc(x.s.title)}">◆ ${esc(x.l.short)} · ${esc(x.s.title)}</button>`)];
      return `<div class="day" style="width:${W}px">${items.join('')}</div>`;
    }).join('');
    const cols = days.map(d => {
      const o = dobj(d), evs = [...g.filter(e => e.date === d && !e.allDay).map(e => ({ ...e, g: true })), ...mine.filter(e => e.date === d && !e.allDay)].filter(e => e.start).sort((a, b) => a.start.localeCompare(b.start));
      lanes(evs);
      const body = evs.map(e => {
        const y = Math.max(0, toY(e.start)), h2 = Math.max(24, toY(e.end || e.start) - toY(e.start) - 3);
        const w = 100 / e._n, left = e._lane * w;
        const attr = e.g ? `data-gev="${esc(JSON.stringify({ title: e.title, date: e.date, start: e.start, end: e.end, location: e.location, url: e.url, conflict: e.conflict }))}"` : `data-mev="${e.id}"`;
        return `<button class="ev ${e.g ? 'g' : 'mine'}" ${attr} style="top:${y}px;height:${h2}px;left:calc(${left}% + 4px);right:auto;width:calc(${w}% - 8px)">${esc(e.title)}<small>${e.start}–${e.end || ''}${e.location ? ' · ' + esc(e.location) : ''}</small></button>`;
      }).join('');
      let now = '';
      if (d === S.today) { const t = new Intl.DateTimeFormat('en-GB', { timeZone: S.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); now = `<div class="nowl" style="top:${toY(t)}px"></div>`; }
      return `<div class="col ${o.getUTCDay() === 1 ? 'wk' : ''} ${d === S.today ? 'today' : ''} ${R.dayDiff(S.today, d) < 0 ? 'past' : ''}" data-day="${d}" style="width:${W}px;height:${H}px">${body}${now}</div>`;
    }).join('');
    const gut = [...Array(CAL.h1 - CAL.h0)].map((_, i) => `<div style="height:${CAL.hh}px">${String(CAL.h0 + i).padStart(2, '0')}:00</div>`).join('');
    const c = S.calendar || {};
    v.innerHTML = `
      <div class="ph"><h2>CAL<span>ENDAR</span></h2><span class="month" id="month"></span><div class="sp"></div>
        <div class="calbar"><button class="btn sm" data-cal="-7" title="Previous week">‹ WEEK</button><button class="btn sm dark" data-cal="today">TODAY</button><button class="btn sm" data-cal="7" title="Next week">WEEK ›</button><button class="btn sm acc" data-act="newevent">+ EVENT</button></div></div>
      <div class="ph" style="padding-top:0"><span class="calnote">${c.ok === false ? '⚠ ' + esc(c.error) : `Google Calendar export${c.exportedAt ? ' · ' + esc(c.exportedAt) : ''}${c.covered ? ' · covers ' + esc(c.covered) : ''}`} · ◆ = quest planned/due dates · drag or scroll to move in time · click an empty slot to add an event</span></div>
      <div class="cal" id="cal"><div class="cg" style="width:${58 + N * W}px">
        <div class="ch"><div class="gut"></div>${head}</div>
        <div class="cad"><div class="gut">ALL DAY</div>${allday}</div>
        <div class="cbody"><div class="gut">${gut}</div>${cols}</div>
      </div></div>`;
    const cal = $('#cal');
    if (keep) { cal.scrollLeft = keep.left; cal.scrollTop = keep.top; }
    else { cal.scrollLeft = (CAL.back - 1) * W; cal.scrollTop = (8 - CAL.h0) * CAL.hh; }
    const upd = () => { U.cal = { left: cal.scrollLeft, top: cal.scrollTop }; const i = Math.min(N - 1, Math.floor((cal.scrollLeft + W * 2) / W)); const o = dobj(days[i]); $('#month').textContent = `${['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'][o.getUTCMonth()]} ${o.getUTCFullYear()}`; };
    cal.addEventListener('scroll', upd, { passive: true }); upd();
    dragScroll(cal, 'xy');
  }
  function lanes(evs) {
    let cluster = [], end = '';
    const flush = () => { const n = Math.max(1, ...cluster.map(e => e._lane + 1)); cluster.forEach(e => e._n = n); cluster = []; };
    evs.forEach(e => {
      if (cluster.length && e.start >= end) flush();
      const used = cluster.filter(o => o.end > e.start).map(o => o._lane); let k = 0; while (used.includes(k)) k++;
      e._lane = k; cluster.push(e); end = cluster.reduce((m, o) => (o.end || o.start) > m ? (o.end || o.start) : m, '');
    });
    if (cluster.length) flush();
  }
  function dragScroll(el, axes) {
    let sx = 0, sy = 0, sl = 0, st = 0, down = false; el._moved = false;
    el.addEventListener('mousedown', e => { if (e.button !== 0 || e.target.closest('button,input,textarea,a')) return; down = true; el._moved = false; sx = e.clientX; sy = e.clientY; sl = el.scrollLeft; st = el.scrollTop; });
    window.addEventListener('mousemove', e => { if (!down) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 5) { el._moved = true; el.classList.add('drag'); } if (axes.includes('x')) el.scrollLeft = sl - dx; if (axes.includes('y')) el.scrollTop = st - dy; });
    window.addEventListener('mouseup', () => { if (down) { down = false; el.classList.remove('drag'); setTimeout(() => el._moved = false, 0); } });
  }

  /* ---------- inbox ---------- */
  function renderInbox(v) {
    const opts = lines().map(l => `<option value="${l.id}">${short(l.id)} · ${esc(l.name)}</option>`).join('');
    v.innerHTML = `<div class="ph"><h2>IN<span>BOX</span></h2><span class="hint">Capture anything. Sort it into a mission line later — nothing here is a commitment yet.</span></div>
      <div class="pb"><div class="ibox">
        <form class="cap" data-capture><input class="inp" id="capin" placeholder="Capture a thought, idea or request…" autocomplete="off"><button class="btn dark">CAPTURE</button></form>
        ${S.state.inbox.map(x => `<div class="ii" data-ii="${x.id}"><div class="t">${esc(x.t)}<small>${x.at ? x.at.slice(0, 10) : ''}</small></div>
          <select class="sel" data-pline="${x.id}">${opts}</select>
          <button class="btn sm" data-promote="${x.id}|sub">→ SUBTASK</button><button class="btn sm acc" data-promote="${x.id}|step">→ MAIN STEP</button><button class="btn sm ghost" data-delinbox="${x.id}" title="Discard">✕</button></div>`).join('')
      || `<div class="empty"><svg width="110" height="140" viewBox="10 0 140 200"><g class="hop">${giraffeSVG('happy')}</g></svg><div><b>INBOX ZERO</b><span class="calnote">Everything is sorted into a mission line.</span></div></div>`}
      </div></div>`;
  }

  /* ================= modals ================= */
  function modal(html, onMount) { $('#modal').innerHTML = html; $('#scrim').classList.add('on'); if (onMount) onMount($('#modal')); setTimeout(() => { const f = $('#modal [autofocus]') || $('#modal input:not([type=checkbox]),#modal textarea'); f && f.focus(); }, 30); }
  function closeModal() { $('#scrim').classList.remove('on'); }
  function confirmBox(title, text, yes, fn) {
    modal(`<div class="mh"><b>${title}</b></div><div class="mb"><p style="margin:0">${text}</p></div><div class="mf"><span class="hint"></span><button class="btn ghost" data-close>CANCEL</button><button class="btn acc" id="yes">${yes}</button></div>`,
      m => $('#yes', m).onclick = () => { closeModal(); fn(); });
  }
  const lineOpts = sel => lines().map(l => `<option value="${l.id}" ${l.id === sel ? 'selected' : ''}>${short(l.id)} · ${esc(l.name)}</option>`).join('');
  function openNew(kind = 'step', pre = {}) {
    const cur = pre.line || U.open || (lines()[0] || {}).id;
    const tabs = [['step', 'MAIN STEP'], ['sub', 'SUBTASK'], ['event', 'EVENT'], ['line', 'MISSION LINE'], ['inbox', 'INBOX']];
    let body = '';
    if (kind === 'step') body = `<div class="fld"><label>Mission line</label><select id="f-line">${lineOpts(cur)}</select></div>
      <div class="fld"><label>Title</label><input id="f-title" placeholder="e.g. Print and fit HBPA end caps" autofocus></div>
      <div class="three"><div class="fld"><label>Priority</label><select id="f-prio"><option value="high">High</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></div>
        <div class="fld"><label>Planned date</label><input type="date" id="f-planned"></div><div class="fld"><label>Hard deadline</label><input type="date" id="f-due"></div></div>
      <div class="two"><div class="fld"><label>Position</label><select id="f-pos"><option value="end">End of the line</option><option value="next">Right after the current step</option></select></div>
        <div class="fld"><label>&nbsp;</label><label class="chk"><input type="checkbox" id="f-today"> Add to today</label></div></div>
      <div class="fld"><label>Note (optional)</label><textarea id="f-note" rows="2"></textarea></div>`;
    else if (kind === 'sub') { const l = L(cur); body = `<div class="fld"><label>Mission line</label><select id="f-line" data-relink>${lineOpts(cur)}</select></div>
      <div class="fld"><label>Under step</label><select id="f-step">${(l ? l.steps.filter(s => s.status !== 'done') : []).map(s => `<option value="${s.id}" ${s.id === pre.step ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></div>
      <div class="fld"><label>Subtask</label><input id="f-title" placeholder="e.g. Degas silicone batch" autofocus></div>`; }
    else if (kind === 'event') body = `<div class="fld"><label>Title</label><input id="f-title" placeholder="e.g. Molding session" autofocus></div>
      <div class="three"><div class="fld"><label>Date</label><input type="date" id="f-date" value="${pre.date || S.today}"></div><div class="fld"><label>Start</label><input type="time" id="f-start" value="${pre.start || '13:00'}"></div><div class="fld"><label>End</label><input type="time" id="f-end" value="${pre.end || '14:00'}"></div></div>
      <div class="two"><div class="fld"><label>Link to mission (optional)</label><select id="f-line"><option value="">—</option>${lineOpts('')}</select></div><div class="fld"><label>&nbsp;</label><label class="chk"><input type="checkbox" id="f-allday"> All-day</label></div></div>`;
    else if (kind === 'line') body = lineForm({});
    else body = `<div class="fld"><label>Thought</label><textarea id="f-title" rows="3" placeholder="Anything — sort it later" autofocus></textarea></div>`;
    modal(`<div class="mh"><b>+ NEW QUEST</b><span class="sp"></span><button class="btn sm ghost" style="color:var(--paper)" data-close>ESC ✕</button></div>
      <div class="mtabs">${tabs.map(([k, t]) => `<button class="mtab ${k === kind ? 'on' : ''}" data-mtab="${k}">${t}</button>`).join('')}</div>
      <div class="mb">${body}<div class="err" id="f-err"></div></div>
      <div class="mf"><span class="hint">${DEMO ? 'Demo mode — saved in this browser tab only' : 'Saves to quest/*.json → git commit → push'}</span><button class="btn ghost" data-close>CANCEL</button><button class="btn acc" id="f-save">SAVE</button></div>`,
      m => {
        $$('[data-mtab]', m).forEach(b => b.onclick = () => openNew(b.dataset.mtab, { line: ($('#f-line', m) || {}).value || cur }));
        const rl = $('[data-relink]', m); if (rl) rl.onchange = () => openNew('sub', { line: rl.value });
        $('#f-save', m).onclick = () => saveNew(kind);
      });
  }
  function lineForm(l) {
    const b = l.boss || {};
    return `<div class="two"><div class="fld"><label>Name</label><input id="f-name" value="${esc(l.name || '')}" placeholder="e.g. MRI Insertion Unit" autofocus></div><div class="fld"><label>Short code</label><input id="f-short" maxlength="8" value="${esc(l.short || '')}" placeholder="e.g. INSERT"></div></div>
      <div class="three"><div class="fld"><label>Priority</label><select id="f-prio">${['high', 'normal', 'low'].map(p => `<option ${p === (l.prio || 'normal') ? 'selected' : ''}>${p}</option>`).join('')}</select></div><div class="fld"><label>Parent line</label><select id="f-parent"><option value="">— none (top level) —</option>${S.state.lines.filter(x => !x.parent && x.id !== l.id).map(x => `<option value="${x.id}" ${x.id === l.parent ? 'selected' : ''}>${short(x.id)} · ${esc(x.short)}</option>`).join('')}</select></div><div class="fld"><label>Blurb</label><input id="f-blurb" value="${esc(l.blurb || '')}"></div></div>
      <div class="three"><div class="fld"><label>Boss (deadline) name</label><input id="f-bname" value="${esc(b.name || '')}" placeholder="e.g. ICRA paper"></div><div class="fld"><label>Boss date</label><input type="date" id="f-bdate" value="${b.date || ''}"></div><div class="fld"><label>Boss note</label><input id="f-bnote" value="${esc(b.note || '')}"></div></div>`;
  }
  const val = id => { const e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : undefined; };
  async function saveNew(kind) {
    let a;
    if (kind === 'step') a = { type: 'add_step', line: val('f-line'), title: val('f-title'), priority: val('f-prio'), planned: val('f-planned'), due: val('f-due'), position: val('f-pos'), note: val('f-note'), today: val('f-today') };
    else if (kind === 'sub') a = { type: 'add_sub', line: val('f-line'), step: val('f-step'), t: val('f-title') };
    else if (kind === 'event') a = { type: 'add_event', title: val('f-title'), date: val('f-date'), start: val('f-allday') ? '' : val('f-start'), end: val('f-allday') ? '' : val('f-end'), allDay: val('f-allday'), line: val('f-line') };
    else if (kind === 'line') a = { type: 'add_line', name: val('f-name'), short: val('f-short'), prio: val('f-prio'), parent: val('f-parent'), blurb: val('f-blurb'), bossName: val('f-bname'), bossDate: val('f-bdate'), bossNote: val('f-bnote') };
    else a = { type: 'inbox_add', t: val('f-title') };
    const r = await act(a, true);
    if (!r) { $('#f-err').textContent = 'Could not save — check the fields (title is required).'; $('#modal').animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], 200); return; }
    closeModal();
    if (kind === 'step' || kind === 'sub') { if (U.view === 'map') U.open = a.line; }
    if (kind === 'line') { U.view = 'map'; U.open = S.state.lines[S.state.lines.length - 1].id; }
    render(); toast('SAVED', esc(r.msg || ''));
  }
  function editStep(key) {
    const [lid, sid] = key.split('|'), s = ST(lid, sid); if (!s) return;
    modal(`<div class="mh"><b>EDIT STEP</b><span class="sp"></span><span class="chipx id" style="color:var(--paper)">${esc(s.id)}</span></div>
      <div class="mb"><div class="fld"><label>Title</label><input id="e-title" value="${esc(s.title)}"></div>
      <div class="three"><div class="fld"><label>Priority</label><select id="e-prio">${['high', 'normal', 'low'].map(p => `<option ${p === s.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="fld"><label>Planned date</label><input type="date" id="e-planned" value="${s.planned || ''}"></div><div class="fld"><label>Hard deadline</label><input type="date" id="e-due" value="${s.due || ''}"></div></div>
      ${s.status !== 'done' ? `<div class="fld"><label>Status</label><select id="e-status"><option value="todo" ${s.status === 'todo' ? 'selected' : ''}>To do</option><option value="doing" ${s.status === 'doing' ? 'selected' : ''}>Doing</option></select></div>` : ''}
      <div class="fld"><label>Note</label><textarea id="e-note" rows="3">${esc(s.note || '')}</textarea></div>
      <div style="display:flex;gap:8px"><button class="btn sm" data-move="-1">↑ MOVE EARLIER</button><button class="btn sm" data-move="1">↓ MOVE LATER</button></div></div>
      <div class="mf"><button class="btn sm ghost" id="e-del" style="color:var(--red)">DELETE STEP</button><span class="sp"></span><button class="btn ghost" data-close>CANCEL</button><button class="btn acc" id="e-save">SAVE</button></div>`,
      m => {
        $('#e-save', m).onclick = async () => { const r = await act({ type: 'edit_step', line: lid, step: sid, title: val('e-title'), priority: val('e-prio'), planned: val('e-planned'), due: val('e-due'), note: val('e-note'), status: val('e-status') }); if (r) { closeModal(); render(); toast('STEP UPDATED', esc(val('e-title') || '')); } };
        $$('[data-move]', m).forEach(b => b.onclick = async () => { const r = await act({ type: 'edit_step', line: lid, step: sid, move: +b.dataset.move }); if (r) { render(); } });
        $('#e-del', m).onclick = () => confirmBox('DELETE STEP?', `“${esc(s.title)}” will be removed from ${esc(L(lid).short)}. Its history stays in git.`, 'DELETE', async () => { const r = await act({ type: 'delete_step', line: lid, step: sid }); if (r) { render(); toast('DELETED', esc(s.title)); } });
      });
  }
  function editLine(lid) {
    const l = L(lid); if (!l) return;
    modal(`<div class="mh"><b>EDIT LINE · ${esc(l.id)}</b></div><div class="mb">${lineForm(l)}
      <div style="display:flex;gap:8px"><button class="btn sm" data-lmove="-1">↑ MOVE UP</button><button class="btn sm" data-lmove="1">↓ MOVE DOWN</button></div></div>
      <div class="mf"><span class="hint">Clear the boss name to remove the boss.</span><button class="btn ghost" data-close>CANCEL</button><button class="btn acc" id="l-save">SAVE</button></div>`,
      m => {
        $('#l-save', m).onclick = async () => { const r = await act({ type: 'edit_line', line: lid, name: val('f-name'), short: val('f-short'), prio: val('f-prio'), parent: val('f-parent'), blurb: val('f-blurb'), bossName: val('f-bname'), bossDate: val('f-bdate'), bossNote: val('f-bnote') }); if (r) { closeModal(); render(); toast('LINE UPDATED', esc(val('f-name'))); } };
        $$('[data-lmove]', m).forEach(b => b.onclick = async () => { const r = await act({ type: 'edit_line', line: lid, move: +b.dataset.lmove }); if (r) render(); });
      });
  }
  function openPicker() {
    const cands = [];
    lines().forEach(l => { const f = R.frontier(l); l.steps.forEach((s, i) => { if (s.status !== 'done' && (i === f || s.status === 'doing') && !isFocus(l.id, s.id)) cands.push({ l, s, u: urg(s) }); }); });
    cands.sort((a, b) => (a.u ? a.u.days : 999) - (b.u ? b.u.days : 999) || ({ high: 0, normal: 1, low: 2 }[a.l.prio] - { high: 0, normal: 1, low: 2 }[b.l.prio]));
    modal(`<div class="mh"><b>PICK TODAY'S QUEST</b><span class="sp"></span><span style="font:700 11px var(--B);letter-spacing:1px">${S.state.focus.length}/${R.FOCUS_MAX} PICKED</span></div>
      <div class="mb" style="gap:8px">${cands.map(({ l, s, u }) => `<button class="pk" data-pickit="${l.id}|${s.id}"><span class="chip" style="width:auto;height:30px;box-shadow:none;pointer-events:none"><span class="id">${short(l.id)}</span><span class="nm" style="font-size:15px">${esc(l.short)}</span></span><span class="t">${esc(s.title)}<small>${u ? urgText(u, true) : 'no date'} · +${R.XP[s.priority] || 30} XP</small></span></button>`).join('') || '<div class="calnote">No open steps.</div>'}</div>
      <div class="mf"><span class="hint">Shows the current step of every line, most urgent first.</span><button class="btn ghost" data-close>CLOSE</button></div>`);
  }

  /* ---------- popovers ---------- */
  function popAt(anchor, html) {
    const p = $('#pop'); p.innerHTML = html; p.classList.add('on');
    const r = anchor.getBoundingClientRect(), w = 300;
    p.style.left = Math.min(innerWidth - w - 12, Math.max(12, r.left)) + 'px';
    const below = r.bottom + 8, h = p.offsetHeight; p.style.top = (below + h > innerHeight - 10 ? Math.max(10, r.top - h - 8) : below) + 'px';
  }
  const closePop = () => $('#pop').classList.remove('on');
  async function syncPop(anchor) {
    const s = S.sync || {};
    const base = DEMO ? `<h4>DEMO MODE</h4><p>Changes stay in this browser tab. Run the server on the Pi to sync with GitHub.</p>` :
      `<h4>${esc(($('#sync span').textContent))}</h4>
       ${s.enabled === false ? '<p>Git is turned off (GIT_ENABLED=false).</p>' : s.push === false ? '<p>Commits stay on the Pi — set <b>GIT_PUSH=true</b> to push to GitHub.</p>' : '<p>Changes are committed and pushed to GitHub automatically (batched every ~20 s).</p>'}
       ${s.lastError ? `<p class="err">${esc(s.lastError)}</p>` : ''}
       ${s.lastCommit ? `<p>Last commit <code>${esc(s.lastCommit.hash)}</code> ${esc(s.lastCommit.subject)}</p>` : ''}
       <div class="log" id="slog">Loading recent commits…</div>
       <div class="r"><button class="btn sm dark" data-syncnow>SYNC NOW</button><button class="btn sm ghost" data-closepop>CLOSE</button></div>`;
    popAt(anchor, base);
    if (!DEMO) try { const j = await (await fetch('api/sync')).json(); const el = $('#slog'); if (el) el.innerHTML = (j.recent || []).map(c => `<div><code>${esc(c.hash)}</code>${esc(c.subject)}</div>`).join('') || 'No quest commits yet.'; } catch { }
  }
  function eventPop(anchor, e, mine) {
    popAt(anchor, `<h4>${esc(e.title)}</h4><p>${md(e.date)}${e.start ? ` · ${e.start}–${e.end || ''}` : ' · all day'}</p>${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}${e.conflict ? `<p class="err">${esc(e.conflict)}</p>` : ''}
      ${e.line ? `<p>Linked to ${esc((L(e.line) || {}).name || e.line)}</p>` : ''}<p class="calnote">${mine ? 'Added in Quest Log' : 'From Google Calendar (read-only export)'}</p>
      <div class="r">${mine ? `<button class="btn sm" data-delevent="${e.id}" style="color:var(--red)">DELETE</button>` : e.url ? `<a class="btn sm dark" href="${esc(e.url)}" target="_blank" rel="noopener" style="text-decoration:none">OPEN IN GOOGLE</a>` : ''}<button class="btn sm ghost" data-closepop>CLOSE</button></div>`);
  }

  /* ---------- toasts ---------- */
  function toast(title, text, err) {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.innerHTML = `<b>${title}</b>${text || ''}`;
    $('#toasts').appendChild(t); setTimeout(() => { t.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(10px)' }], 250).finished.then(() => t.remove()); }, 3200);
  }

  /* ================= events ================= */
  document.addEventListener('click', async e => {
    const t = e.target.closest('button,[data-jump],[data-expand],.col,a'); if (!t) { if (!e.target.closest('#pop')) closePop(); return; }
    const d = t.dataset;
    if (!t.closest('#pop') && !('sync' === t.id)) closePop();
    if (d.go) { U.view = d.go; try { localStorage.setItem('ql.view', d.go); } catch { } renderNav(); renderView(); return; }
    if (t.id === 'newBtn') return openNew('step');
    if (t.id === 'sync') return syncPop(t);
    if (d.closepop != null) return closePop();
    if (d.syncnow != null) { t.textContent = 'SYNCING…'; try { const j = await (await fetch('api/sync', { method: 'POST' })).json(); const k = U.shownXP; S = j; U.shownXP = k; renderNav(); syncPop($('#sync')); toast('SYNC', esc((S.sync || {}).state || '')); } catch (er) { toast('SYNC FAILED', er.message, true); } return; }
    if (d.toggle) return toggleLine(d.toggle);
    if (d.goto) { const [l, s] = d.goto.split('|'); return gotoStep(l, s); }
    if (d.jump) { const [l, s] = d.jump.split('|'); if (t.closest('.trail') && t.closest('.trail')._moved) return; return gotoStep(l, s); }
    if (d.expand) { const s = ST(...d.expand.split('|')); const isNow = s && document.getElementById('st-' + cssId(d.expand)).classList.contains('now'); const cur = U.stepOpen[d.expand] != null ? U.stepOpen[d.expand] : (isNow && s.status !== 'done'); U.stepOpen[d.expand] = !cur; return renderMap($('#view')); }
    if (d.complete) return openComplete(d.complete, d.where);
    if (d.cancel != null) { U.completing = null; return render(); }
    if (d.submit) return submitComplete(d.submit, t);
    if (d.sub) { const [l, s, sub] = d.sub.split('|'); const r0 = t.getBoundingClientRect(), old = U.shownXP; const r = await act({ type: 'toggle_sub', line: l, step: s, sub }); if (r) { renderMap($('#view')); renderRail(); flyXP({ x: r0.left + 11, y: r0.top + 11 }, r.xp, old, S.state.player.xp); } return; }
    if (d.delsub) { const [l, s, sub] = d.delsub.split('|'); if (await act({ type: 'delete_sub', line: l, step: s, sub })) render(); return; }
    if (d.focus) { const [l, s] = d.focus.split('|'); const r = await act({ type: isFocus(l, s) ? 'focus_remove' : 'focus_add', line: l, step: s }); if (r) { render(); toast(isFocus(l, s) ? 'ADDED TO TODAY' : 'DROPPED FROM TODAY', esc(ST(l, s).title)); } return; }
    if (d.unfocus) { const [l, s] = d.unfocus.split('|'); const q = t.closest('.q'); await q.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(30px)' }], 220).finished; if (await act({ type: 'focus_remove', line: l, step: s })) render(); return; }
    if (d.edit) return editStep(d.edit);
    if (d.showdone) { U.showDone[d.showdone] = !U.showDone[d.showdone]; return renderMap($('#view')); }
    if (d.lateall != null) { U.lateAll = !U.lateAll; return renderRail(); }
    if (d.soonall != null) { U.soonAll = !U.soonAll; U.soonCap = 4; return renderRail(); }
    if (d.act === 'pick') return openPicker();
    if (d.act === 'newline') return openNew('line');
    if (d.act === 'addstep') return openNew('step', { line: d.line });
    if (d.act === 'editline') return editLine(d.line);
    if (d.act === 'newevent') return openNew('event');
    if (d.pickit) { const [l, s] = d.pickit.split('|'); const r = await act({ type: 'focus_add', line: l, step: s }); if (r) { render(); if (S.state.focus.length >= R.FOCUS_MAX) closeModal(); else openPicker(); toast('ADDED TO TODAY', esc(ST(l, s).title)); } return; }
    if (d.close != null) return closeModal();
    if (d.cal) { const c = $('#cal'); if (d.cal === 'today') c.scrollTo({ left: (CAL.back - 1) * CAL.colW, behavior: 'smooth' }); else c.scrollBy({ left: +d.cal * CAL.colW, behavior: 'smooth' }); return; }
    if (d.gev) return eventPop(t, JSON.parse(d.gev), false);
    if (d.mev) { const ev = S.state.events.find(x => x.id === d.mev); return ev && eventPop(t, ev, true); }
    if (d.delevent) { closePop(); if (await act({ type: 'delete_event', id: d.delevent })) { render(); toast('EVENT DELETED', ''); } return; }
    if (d.promote) { const [id, kind] = d.promote.split('|'); const line = $(`[data-pline="${id}"]`).value; const row = t.closest('.ii'); await row.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(40px)' }], 250).finished; if (await act({ type: 'inbox_promote', id, line, kind })) { render(); toast('SORTED', `Moved to ${esc(L(line).short)} as a ${kind === 'sub' ? 'subtask' : 'main step'}`); } else render(); return; }
    if (d.delinbox) { if (await act({ type: 'inbox_delete', id: d.delinbox })) render(); return; }
    if (t.classList.contains('col') && !e.target.closest('.ev')) {
      const cal = $('#cal'); if (cal && cal._moved) return;
      const y = e.clientY - t.getBoundingClientRect().top, mins = Math.floor((CAL.h0 * 60 + y / CAL.hh * 60) / 30) * 30;
      const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      return openNew('event', { date: t.dataset.day, start: hm(mins), end: hm(Math.min(mins + 60, 23 * 60 + 59)) });
    }
  });
  $('#bosses').addEventListener('click', nextBoss);
  $('#scrim').addEventListener('mousedown', e => { if (e.target.id === 'scrim') closeModal(); });
  document.addEventListener('keydown', async e => {
    const tag = (document.activeElement || {}).tagName;
    if (e.key === 'Escape') { closeModal(); closePop(); if (U.completing) { U.completing = null; render(); } return; }
    if (e.target.matches('[data-addsub]') && e.key === 'Enter' && e.target.value.trim()) { const [l, s] = e.target.dataset.addsub.split('|'); const k = e.target.dataset.addsub; if (await act({ type: 'add_sub', line: l, step: s, t: e.target.value })) { U.stepOpen[k] = true; renderMap($('#view')); const n = $(`[data-addsub="${CSS.escape(k)}"]`); n && n.focus(); } return; }
    if (e.target.matches('[data-addstep]') && e.key === 'Enter' && e.target.value.trim()) { const l = e.target.dataset.addstep; if (await act({ type: 'add_step', line: l, title: e.target.value })) { renderMap($('#view')); renderRail(); const n = $(`[data-addstep="${l}"]`); n && n.focus(); toast('NEW STEP', 'Added to the end of the line'); } return; }
    if (e.target.matches('[data-comment]') && e.key === 'Enter' && e.target.value.trim()) { const [l, s] = e.target.dataset.comment.split('|'); if (await act({ type: 'comment_step', line: l, step: s, text: e.target.value })) { renderMap($('#view')); toast('NOTE SAVED', ''); } return; }
    if (e.target.matches('[data-cmt]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { const b = e.target.closest('.cform').querySelector('[data-submit]'); return submitComplete(b.dataset.submit, b); }
    if ($('#scrim').classList.contains('on') && e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON') { const b = $('#f-save') || $('#e-save') || $('#l-save'); if (b) { e.preventDefault(); b.click(); } return; }
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNew('step'); }
    if (e.key === '1') { U.view = 'map'; render(); } if (e.key === '2') { U.view = 'cal'; render(); } if (e.key === '3') { U.view = 'inbox'; render(); }
  });
  document.addEventListener('submit', async e => {
    if (e.target.matches('[data-capture]')) { e.preventDefault(); const v = $('#capin').value.trim(); if (!v) return; if (await act({ type: 'inbox_add', t: v })) { render(); const n = $('#capin'); n && n.focus(); toast('CAPTURED', 'Sort it into a line when ready'); } }
  });
  window.addEventListener('resize', () => { if (U.view === 'map') drawTrunks(); clearTimeout(U.rsz); U.rsz = setTimeout(() => { U.soonCap = 4; renderRail(); }, 150); });

  /* ================= boot ================= */
  async function refresh() {
    if (DEMO || $('#scrim').classList.contains('on') || U.completing || U.busy || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName)) return;
    try { const r = await fetch('api/state'); if (!r.ok) return; const j = await r.json(); const changed = JSON.stringify(j.state) !== JSON.stringify(S.state) || j.today !== S.today; const k = U.shownXP; S = j; U.shownXP = changed ? j.state.player.xp : k; if (changed) render(); else renderNav(); } catch { }
  }
  (async () => {
    try { await load(); } catch (e) { document.body.insertAdjacentHTML('beforeend', `<div class="login"><div class="card"><div class="sticker a">OFFLINE</div><p>Cannot reach the Quest Log server: ${esc(e.message)}</p><button class="btn dark" onclick="location.reload()">RETRY</button></div></div>`); return; }
    if (!S) return;
    if (U.open && !L(U.open)) U.open = null;
    render();
    setInterval(refresh, 20000);
  })();
})();
