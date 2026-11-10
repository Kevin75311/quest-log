// Git sync worker: debounced commit -> pull --rebase -> push, plus periodic pull.
// Never force-pushes, never resets. On a rebase conflict it aborts the rebase,
// keeps the local commit and reports status "conflict" so you can resolve by hand.
'use strict';
const { execFile } = require('child_process');

function run(cwd, args, timeout = 60000) {
  return new Promise(resolve => {
    execFile('git', args, { cwd, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) =>
      resolve({ ok: !err, code: err ? err.code : 0, out: String(stdout).trim(), err: String(stderr).trim() }));
  });
}

class GitSync {
  constructor(opts) {
    this.o = opts; // {repo, dataDir, branch, remote, push, debounceMs, pullMs, authorName, authorEmail, onExternalChange, log}
    this.pending = []; this.timer = null; this.busy = false;
    this.status = { state: opts.enabled ? 'idle' : 'disabled', lastSync: null, lastError: null, ahead: 0, lastCommit: null };
  }
  async start() {
    if (!this.o.enabled) return;
    const r = await run(this.o.repo, ['rev-parse', '--is-inside-work-tree']);
    if (!r.ok) { this.status = { ...this.status, state: 'error', lastError: 'REPO_DIR is not a git repository' }; return; }
    await this.refreshHead();
    if (this.o.pullMs > 0) setInterval(() => this.pull().catch(() => {}), this.o.pullMs);
  }
  async refreshHead() {
    const h = await run(this.o.repo, ['log', '-1', '--format=%h|%s|%cI']);
    if (h.ok && h.out) { const [hash, subject, at] = h.out.split('|'); this.status.lastCommit = { hash, subject, at }; }
  }
  async recent(n = 8) {
    if (!this.o.enabled) return [];
    const r = await run(this.o.repo, ['log', `-${n}`, '--format=%h|%s|%cI', '--', this.o.dataDir]);
    return r.ok && r.out ? r.out.split('\n').map(l => { const [hash, subject, at] = l.split('|'); return { hash, subject, at }; }) : [];
  }
  async waitIdle(maxMs = 20000) { const t0 = Date.now(); while (this.busy && Date.now() - t0 < maxMs) await new Promise(r => setTimeout(r, 100)); }
  queue(msg) {
    if (!this.o.enabled) return;
    if (msg) this.pending.push(msg);
    this.status.state = 'pending';
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.o.debounceMs);
  }
  async flush() {
    if (!this.o.enabled) return this.status;
    if (this.busy) { this.queue(); return this.status; }
    this.busy = true; clearTimeout(this.timer);
    const msgs = this.pending.splice(0);
    try {
      const repo = this.o.repo;
      await run(repo, ['add', '--', this.o.dataDir, ...(this.o.extraFiles || [])]);
      const diff = await run(repo, ['diff', '--cached', '--quiet']);
      if (!diff.ok) {
        const subject = msgs.length === 1 ? msgs[0] : `quest: ${msgs.length || 'several'} updates from Quest Log`;
        const body = msgs.length > 1 ? msgs.map(m => '- ' + m).join('\n') : '';
        const args = ['-c', `user.name=${this.o.authorName}`, '-c', `user.email=${this.o.authorEmail}`, 'commit', '-m', subject];
        if (body) args.push('-m', body);
        const c = await run(repo, args);
        if (!c.ok) throw new Error('commit failed: ' + (c.err || c.out));
      }
      if (this.o.push) {
        this.status.state = 'pushing';
        const ok = await this.pullRebase();
        if (!ok) return this.status;
        const p = await run(repo, ['push', this.o.remote, `HEAD:${this.o.branch}`], 120000);
        if (!p.ok) throw new Error('push failed: ' + (p.err || p.out));
      }
      await this.refreshHead();
      this.status = { ...this.status, state: this.o.push ? 'synced' : 'committed', lastSync: new Date().toISOString(), lastError: null };
    } catch (e) {
      this.status = { ...this.status, state: 'error', lastError: e.message };
      this.o.log('git: ' + e.message);
      this.pending.unshift(...msgs.filter(m => !this.pending.includes(m)));
    } finally { this.busy = false; }
    return this.status;
  }
  async pullRebase() {
    const repo = this.o.repo;
    const before = (await run(repo, ['rev-parse', 'HEAD'])).out;
    const f = await run(repo, ['pull', '--rebase', '--autostash', this.o.remote, this.o.branch], 120000);
    if (!f.ok) {
      await run(repo, ['rebase', '--abort']);
      this.status = { ...this.status, state: 'conflict', lastError: 'Remote has conflicting changes. Resolve in ' + repo + ' (git status), then press Sync now. ' + (f.err || '').slice(0, 300) };
      this.o.log('git: pull --rebase failed: ' + f.err);
      return false;
    }
    const after = (await run(repo, ['rev-parse', 'HEAD'])).out;
    if (before !== after) this.o.onExternalChange();
    return true;
  }
  async pull() {
    if (!this.o.enabled || !this.o.push || this.busy || this.pending.length) return;
    this.busy = true;
    try { if (await this.pullRebase()) { await this.refreshHead(); if (this.status.state !== 'conflict') this.status = { ...this.status, state: 'synced', lastSync: new Date().toISOString(), lastError: null }; } }
    finally { this.busy = false; }
  }
}
module.exports = { GitSync };
