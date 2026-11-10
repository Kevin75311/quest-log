#!/usr/bin/env node
// Quest Log server — zero npm dependencies. Node 18+.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('../public/js/reducer.js');
const { Store } = require('./store.js');
const { GitSync } = require('./git.js');
const { readCalendar } = require('./calendar.js');

const ROOT = path.resolve(__dirname, '..');
loadEnvFile(process.env.ENV_FILE || path.join(ROOT, '.env'));

const CFG = {
  host: process.env.HOST || '0.0.0.0',
  port: +(process.env.PORT || 8787),
  repo: path.resolve(process.env.REPO_DIR || path.join(ROOT, 'data', 'personal-os')),
  dataDir: process.env.DATA_SUBDIR || 'quest',
  calendarFile: process.env.CALENDAR_FILE || 'calendar.md',
  tz: process.env.TZ_NAME || 'America/Los_Angeles',
  passcode: process.env.QUEST_PASSCODE || '',
  git: {
    enabled: (process.env.GIT_ENABLED || 'true') === 'true',
    push: (process.env.GIT_PUSH || 'false') === 'true',
    remote: process.env.GIT_REMOTE || 'origin',
    branch: process.env.GIT_BRANCH || 'main',
    debounceMs: +(process.env.COMMIT_DEBOUNCE_MS || 20000),
    pullMs: +(process.env.PULL_INTERVAL_MS || 300000),
    authorName: process.env.GIT_AUTHOR_NAME || 'Quest Log (rpi)',
    authorEmail: process.env.GIT_AUTHOR_EMAIL || 'quest-log@localhost',
  },
};
const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadEnvFile(f) {
  try {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (!m || line.trim().startsWith('#')) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
function todayIn(tz) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function ctx() { return { today: todayIn(CFG.tz), now: new Date().toISOString() }; }

// ---------- data ----------
const store = new Store(path.join(CFG.repo, CFG.dataDir), path.join(ROOT, 'seed'));
const seeded = store.ensure();
store.load();
if (seeded) { store.save(store.state, ctx().today); log(`Seeded ${CFG.dataDir}/ from the bundled seed. Review it before enabling GIT_PUSH.`); }

let cal = { mtime: 0, data: { events: [] } };
function calendar() {
  const f = path.join(CFG.repo, CFG.calendarFile);
  let mt = 0; try { mt = fs.statSync(f).mtimeMs; } catch { }
  if (mt !== cal.mtime) cal = { mtime: mt, data: readCalendar(f) };
  return cal.data;
}

const git = new GitSync({ ...CFG.git, repo: CFG.repo, dataDir: CFG.dataDir, extraFiles: ['tasks.md', 'job-lines.md'], log, onExternalChange: () => { try { store.load(); log('Reloaded quest data after pull'); } catch (e) { log('reload failed', e.message); } } });
git.start();
// Regenerate tasks.md / job-lines.md once at startup so they match the current data.
setTimeout(() => { try { store.save(store.state, ctx().today); git.queue('docs: regenerate tasks.md and job-lines.md from Quest Log'); } catch (e) { log('regenerate failed', e.message); } }, 3000);
function autoClose() {
  try { const r = R.apply(store.state, { type: 'auto_close' }, ctx()); if (r.msg) { store.save(r.state, ctx().today); git.queue(r.msg); log(r.msg); } }
  catch (e) { log('auto_close failed', e.message); }
}
setTimeout(autoClose, 5000); setInterval(autoClose, 3600 * 1000);

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const PUB = path.join(ROOT, 'public');
const token = CFG.passcode ? crypto.createHash('sha256').update('ql:' + CFG.passcode).digest('hex').slice(0, 32) : '';

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) { bad(new Error('Body too large')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { bad(new Error('Invalid JSON')); } }); });
}
function authed(req) {
  if (!CFG.passcode) return true;
  const c = /(?:^|;\s*)ql=([a-f0-9]+)/.exec(req.headers.cookie || '');
  return c && crypto.timingSafeEqual(Buffer.from(c[1].padEnd(32, '0').slice(0, 32)), Buffer.from(token));
}
async function payload() {
  return { state: store.state, calendar: calendar(), sync: { ...git.status, push: CFG.git.push, enabled: CFG.git.enabled }, today: todayIn(CFG.tz), now: new Date().toISOString(), tz: CFG.tz };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const b = await readBody(req);
        if (!CFG.passcode || b.passcode === CFG.passcode) return send(res, 200, { ok: true }, undefined, CFG.passcode ? { 'Set-Cookie': `ql=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` } : {});
        return send(res, 401, { error: 'Wrong passcode' });
      }
      if (!authed(req)) return send(res, 401, { error: 'login required' });
      if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, await payload());
      if (url.pathname === '/api/action' && req.method === 'POST') {
        const a = await readBody(req);
        await git.waitIdle(); // never write JSON while a pull/rebase is running
        let r; try { r = R.apply(store.state, a, ctx()); } catch (e) { return send(res, 400, { error: e.message }); }
        store.save(r.state, ctx().today);
        if (r.msg) git.queue(r.msg);
        return send(res, 200, { ...(await payload()), xp: r.xp, msg: r.msg });
      }
      if (url.pathname === '/api/sync' && req.method === 'POST') { await git.flush(); await git.pull(); return send(res, 200, { ...(await payload()), recent: await git.recent() }); }
      if (url.pathname === '/api/sync' && req.method === 'GET') return send(res, 200, { sync: git.status, recent: await git.recent() });
      return send(res, 404, { error: 'not found' });
    }
    // static
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    const f = path.join(PUB, p);
    if (!f.startsWith(PUB)) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(f, (err, buf) => {
      if (err) return fs.readFile(path.join(PUB, 'index.html'), (e2, b2) => e2 ? send(res, 404, 'not found', 'text/plain') : send(res, 200, b2, MIME['.html']));
      send(res, 200, buf, MIME[path.extname(f)] || 'application/octet-stream', { 'Cache-Control': /\.(woff2)$/.test(f) ? 'public, max-age=604800' : 'no-cache' });
    });
  } catch (e) { log('error', e.message); send(res, 500, { error: e.message }); }
});
server.listen(CFG.port, CFG.host, () => log(`Quest Log on http://${CFG.host}:${CFG.port}  repo=${CFG.repo}  git=${CFG.git.enabled ? (CFG.git.push ? 'commit+push' : 'commit only') : 'off'}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { log('flushing before exit…'); try { await git.flush(); } catch { } process.exit(0); });
