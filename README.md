# Quest Log

A game-style board for **personal-os**: your research lines are shown as a mission network, today's quests earn XP, and deadlines appear as countdowns and bosses. Every change is saved as JSON in your `personal-os` GitHub repo.

- **Zero npm dependencies.** You only need Node.js ≥ 18 and git. Runs on a Raspberry Pi 5 with Ubuntu.
- **Data lives in your repo:** `personal-os/quest/*.json`, plus a generated `quest/QUEST-LOG.md` that Claude, Codex and Gemini can read.
- **Git sync:** edits are batched (about 20 s), then committed with readable messages like `quest(JL-08): complete T-20261006-21 "Finish smaller HBPA actuator CAD" +50xp`, rebased onto the remote and pushed. It also pulls every 5 min, so it picks up `calendar.md` exports and edits made by other agents.
- **Calendar:** reads Gemini's `calendar.md` export (read-only). Events you add in Quest Log are stored in `quest/events.json`.

---

## 1. Install on the Raspberry Pi (Ubuntu)

Copy `quest-log-1.0.0.tar.gz` to the Pi, then:

```bash
tar xzf quest-log-1.0.0.tar.gz
cd quest-log
bash deploy/install.sh
```

The installer:

1. Installs `git`, `curl` and Node.js (Ubuntu's package if it is version 18 or newer, otherwise NodeSource 20).
2. Copies the app to `/opt/quest-log`.
3. Creates an SSH **deploy key** (`~/.ssh/quest_log_deploy`) and prints the public key. Add it on GitHub under **personal-os → Settings → Deploy keys → Add deploy key**, and **tick "Allow write access"**. The key can only access this one repo.
4. Clones `git@github.com:Kevin75311/personal-os.git` to `~/personal-os`.
5. Writes `/etc/quest-log.env` with **`GIT_PUSH=false`**.
6. Installs and starts the `quest-log` systemd service on port **8787**.

### First run: review before pushing

On first start the server **seeds `quest/`** from `seed/`. This is an import of your job lines and tasks as of 2026-10-23 (statuses as recorded in `tasks.md`). Steps with a `C-…` id are checkpoints from `job-lines.md` that don't have a task ID yet.

1. Open `http://<pi-ip>:8787` and check the missions. Edit them in the UI if anything is wrong. Changes are committed locally only.
2. Read `~/personal-os/quest/QUEST-LOG.md`.
3. Enable push:

   ```bash
   sudo nano /etc/quest-log.env      # set GIT_PUSH=true
   sudo systemctl restart quest-log
   ```

   The next change (or **Sync → SYNC NOW**) pushes everything to GitHub.

### Reach it from your phone with Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# optional HTTPS on your tailnet, e.g. https://rpi.<tailnet>.ts.net
sudo tailscale serve --bg 8787
```

Install Tailscale on your phone and laptop with the same account, then open `http://<pi-tailscale-ip>:8787`, or the `ts.net` URL if you ran `tailscale serve`. On a phone, use **Add to Home Screen** so it opens like an app.

If you ever expose the app outside Tailscale, set `QUEST_PASSCODE=` in `/etc/quest-log.env`.

---

## 2. Required change in personal-os: the nightly Windows backup

GitHub is now the source of truth, and the Pi pushes during the day. Your Windows nightly backup currently **stops when the remote has moved ahead**. Update `planning/git-backup.md` and the backup automation to:

1. Run `git pull --rebase` (no force, no reset) **before** committing and pushing Drive changes.
2. **Never edit `quest/*.json` from Windows or Drive.** The Pi owns that folder. Agents should read `quest/QUEST-LOG.md` and suggest changes through Quest Log (or an inbox item).
3. `calendar.md` stays Gemini's job. Quest Log only reads it.

Suggested addition to `agent-rules.md`:

> Quest Log (Raspberry Pi) owns `quest/`. Read `quest/QUEST-LOG.md` for current mission-line, today and deadline status. Do not hand-edit `quest/*.json`; use the Quest Log UI or add an inbox item. Pull before pushing; the Pi commits throughout the day.

`tasks.md` and `job-lines.md` are left untouched. When you're ready, you can make `quest/` the authoritative home for tasks and mark those files as historical.

---

## 3. Using it

| Where | What it does |
| --- | --- |
| **Mission map** | One row per mission line. The row shows progress dots, the current step with its urgency (red ≤3 days, yellow ≤7, **?** = date passed and needs a check-in) and the boss countdown. **Click the line chip** to expand it: a station trail of every step (drag sideways), then the full to-do list with subtasks, notes and comments. |
| ☐ on a step / Today item | Opens a comment box. **SUBMIT** (or Ctrl+Enter) completes the step, removes it from Today and sends XP coins flying into the XP bar. |
| ★ on a step | Adds it to or drops it from **Today** (max 3). **+ PICK A QUEST** suggests each line's current step, most urgent first. |
| Subtask ☐ | Completes it instantly for +10 XP. Unchecking takes the XP back. |
| ✎ | Edits the title, priority, planned date, hard deadline, status or note, moves the step earlier or later, or deletes it. |
| **Urgent** card | Everything due within 7 days, plus a collapsible list of check-ins. Click an item to jump to it. |
| **Boss** card | Bosses are line deadlines (set them with EDIT LINE). Click to rotate to the next one. HP = steps left on that line. |
| **Calendar** | Scrolls 180 days ahead: drag, use the scroll wheel, or the WEEK buttons. Shows `calendar.md` events, your own events and ◆ quest dates. Click an empty slot to add an event. |
| **Inbox** | Quick capture. Promote an item to a main step or a subtask of any line. |
| **+ NEW QUEST** (or `N`) | Adds a main step, subtask, event, mission line or inbox item. |
| Sync pill | Shows READY, SAVING…, SYNCED, COMMITTED (PUSH OFF), CONFLICT or ERROR. Click it for recent commits and **SYNC NOW**. |

Keyboard shortcuts: `N` new quest, `1` map, `2` calendar, `3` inbox, `Esc` close.

**XP:** high step 50, normal 30, low 15, subtask 10. Each level is 250 XP. The streak counts consecutive days with at least one completion.

---

## 4. Configuration (`/etc/quest-log.env`)

| Key | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Where the server listens |
| `REPO_DIR` | `~/personal-os` | Path to your clone |
| `DATA_SUBDIR` | `quest` | Folder inside the repo for quest data |
| `CALENDAR_FILE` | `calendar.md` | Gemini export to read |
| `TZ_NAME` | `America/Los_Angeles` | Decides what "today" means |
| `GIT_ENABLED` | `true` | `false` turns off all git operations |
| `GIT_PUSH` | `false` | `true` turns on pull, rebase and push |
| `COMMIT_DEBOUNCE_MS` | `20000` | How long edits are batched before a commit |
| `PULL_INTERVAL_MS` | `300000` | How often to pull remote changes |
| `QUEST_PASSCODE` | empty | If set, the browser asks for this passcode once (stored in an HttpOnly cookie) |

Apply changes with `sudo systemctl restart quest-log`. View logs with `journalctl -u quest-log -f`.

---

## 5. Sync conflicts

The server never force-pushes or resets. If a pull hits a conflict in `quest/*.json`, which happens only when something else edited the same file, it aborts the rebase, keeps the Pi's commit, and the pill turns **CONFLICT**. To fix it:

```bash
bash /opt/quest-log/deploy/resolve-conflict.sh
# 1 = keep the Pi's version of conflicting lines (usual choice)
# 2 = take GitHub's version and discard the Pi's unpushed quest commits
```

---

## 6. Update, back up, uninstall

- **Update:** unpack the new tarball and run `bash deploy/install.sh` again. Your config, deploy key and data are kept.
- **Backup:** your data is the git history of `personal-os/quest/`.
- **Uninstall:** `sudo systemctl disable --now quest-log && sudo rm -rf /opt/quest-log /etc/systemd/system/quest-log.service /etc/quest-log.env`

## 7. Try it without the Pi

- `dist/questlog-demo.html` is a single file you can open in any browser. It runs in demo mode, and changes stay in that tab.
- Run it locally on Windows or macOS: `set GIT_ENABLED=false` (Windows) or `export GIT_ENABLED=false`, set `REPO_DIR` to a scratch folder, then `node server/index.js` and open http://localhost:8787.
- `node scripts/self-test.js` runs the logic tests. `node scripts/build-demo.js path/to/calendar.md` rebuilds the demo.

## 8. Files

```
server/index.js      HTTP server + JSON API (/api/state, /api/action, /api/sync, /api/login)
server/git.js        debounced commit → pull --rebase → push, periodic pull, conflict guard
server/store.js      reads/writes quest/*.json atomically, renders QUEST-LOG.md
server/calendar.js   parser for Gemini's calendar.md export
public/              the UI (index.html, css/app.css, js/app.js, js/reducer.js, js/giraffe.js, fonts/)
public/js/reducer.js all state changes (shared by the server and demo mode)
seed/                initial data imported from personal-os (used only when quest/ is missing)
deploy/              install.sh, quest-log.service, resolve-conflict.sh
```

### API

`POST /api/action` with one of these `type` values:

- `complete_step {line, step, comment}`
- `reopen_step`
- `add_step {line, title, priority, planned, due, position: end|next, note, today}`
- `edit_step {…, move: ±1}`
- `delete_step`
- `toggle_sub` / `add_sub` / `delete_sub`
- `comment_step`
- `focus_add` / `focus_remove`
- `add_line` / `edit_line`
- `add_event` / `delete_event`
- `inbox_add` / `inbox_delete` / `inbox_promote {id, line, kind: step|sub}`

Each call returns the full state.

Fonts: Anton and Rubik (SIL Open Font License, see `public/fonts/`). Raffi the giraffe is an original character made for this project.
