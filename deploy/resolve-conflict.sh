#!/usr/bin/env bash
# Use when the Quest Log sync pill shows CONFLICT (the Pi and GitHub both changed the same quest file).
# Option 1 keeps the Pi's version of conflicting lines (recommended — it is what you see in the browser).
# Option 2 throws away the Pi's unpushed quest commits and takes GitHub's version.
set -euo pipefail
REPO_DIR="${REPO_DIR:-$(grep -E '^REPO_DIR=' /etc/quest-log.env | cut -d= -f2)}"
cd "$REPO_DIR"
echo "Repo: $REPO_DIR"; git status -sb | head -3
echo
echo "1) Keep the Pi's version where they conflict (git pull --rebase -X theirs)"
echo "2) Take GitHub's version and DISCARD unpushed Pi commits (git reset --hard origin/main)"
read -r -p "Choose 1 or 2: " c
sudo systemctl stop quest-log
case "$c" in
  1) git rebase --abort 2>/dev/null || true; git pull --rebase -X theirs origin main && git push origin HEAD:main ;;
  2) read -r -p "Really discard the Pi's unpushed commits? type YES: " y; [ "$y" = YES ] && git fetch origin && git reset --hard origin/main ;;
  *) echo "Nothing done." ;;
esac
sudo systemctl start quest-log
git log --oneline -3
