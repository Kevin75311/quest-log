#!/usr/bin/env bash
# Quest Log installer for Ubuntu on Raspberry Pi 5 (also works on any Ubuntu/Debian box).
# Usage (from the unpacked quest-log folder):   bash deploy/install.sh
# Re-running is safe: it updates the app files and restarts the service, keeping your config and data.
set -euo pipefail

APP_DIR=/opt/quest-log
RUN_USER="${SUDO_USER:-$USER}"
RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
REPO_URL="${REPO_URL:-git@github.com:Kevin75311/personal-os.git}"
REPO_DIR="${REPO_DIR:-$RUN_HOME/personal-os}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

say(){ printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "1/6  Packages (git, curl, Node.js >= 18)"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates rsync openssh-client
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  sudo apt-get install -y nodejs || true
fi
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Installing Node.js 20 from NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"; echo "node $(node -v) at $NODE_BIN"

say "2/6  App files -> $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete --exclude data --exclude .env "$SRC_DIR/" "$APP_DIR/" 2>/dev/null || { sudo rm -rf "$APP_DIR"/{public,server,seed,deploy,scripts}; sudo cp -r "$SRC_DIR"/{public,server,seed,deploy,scripts,package.json,README.md} "$APP_DIR/"; }
sudo chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"

say "3/6  GitHub access (SSH deploy key)"
KEY="$RUN_HOME/.ssh/quest_log_deploy"
if [ ! -f "$KEY" ]; then
  sudo -u "$RUN_USER" mkdir -p "$RUN_HOME/.ssh"; sudo -u "$RUN_USER" chmod 700 "$RUN_HOME/.ssh"
  sudo -u "$RUN_USER" ssh-keygen -t ed25519 -N "" -C "quest-log@$(hostname)" -f "$KEY" >/dev/null
fi
if ! grep -q "quest_log_deploy" "$RUN_HOME/.ssh/config" 2>/dev/null; then
  printf '\nHost github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" | sudo -u "$RUN_USER" tee -a "$RUN_HOME/.ssh/config" >/dev/null
  sudo -u "$RUN_USER" chmod 600 "$RUN_HOME/.ssh/config"
fi
sudo -u "$RUN_USER" sh -c "ssh-keyscan -t ed25519 github.com >> '$RUN_HOME/.ssh/known_hosts' 2>/dev/null; sort -u -o '$RUN_HOME/.ssh/known_hosts' '$RUN_HOME/.ssh/known_hosts'"
echo
echo "Public deploy key (add it at https://github.com/Kevin75311/personal-os/settings/keys"
echo "→ 'Add deploy key' → paste → tick 'Allow write access'):"
echo; cat "$KEY.pub"; echo
read -r -p "Press Enter once the key is added on GitHub… " _

say "4/6  Clone personal-os -> $REPO_DIR"
if [ -d "$REPO_DIR/.git" ]; then
  echo "Already cloned; leaving it as is."
else
  sudo -u "$RUN_USER" git clone "$REPO_URL" "$REPO_DIR"
fi
sudo -u "$RUN_USER" git -C "$REPO_DIR" config pull.rebase true

say "5/6  Config /etc/quest-log.env"
if [ ! -f /etc/quest-log.env ]; then
  sed "s#^REPO_DIR=.*#REPO_DIR=$REPO_DIR#" "$SRC_DIR/.env.example" | sudo tee /etc/quest-log.env >/dev/null
  sudo chmod 640 /etc/quest-log.env; sudo chown root:"$RUN_USER" /etc/quest-log.env
  echo "Created /etc/quest-log.env (GIT_PUSH=false until you review the seeded data)."
else echo "Keeping existing /etc/quest-log.env"; fi

say "6/6  systemd service"
sed -e "s#__USER__#$RUN_USER#g" -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__NODE__#$NODE_BIN#g" -e "s#__HOME__#$RUN_HOME#g" \
  "$SRC_DIR/deploy/quest-log.service" | sudo tee /etc/systemd/system/quest-log.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now quest-log
sleep 2; sudo systemctl --no-pager --lines=5 status quest-log || true

IP=$(hostname -I | awk '{print $1}')
echo
echo "✅ Quest Log is running:  http://$IP:$(grep -E '^PORT=' /etc/quest-log.env | cut -d= -f2)"
command -v tailscale >/dev/null && echo "   Tailscale:            http://$(tailscale ip -4 2>/dev/null | head -1):8787" || echo "   Tailscale not installed — see README (curl -fsSL https://tailscale.com/install.sh | sh)"
echo
echo "Next: open it, review $REPO_DIR/quest/QUEST-LOG.md, then set GIT_PUSH=true in /etc/quest-log.env"
echo "      and run: sudo systemctl restart quest-log"
