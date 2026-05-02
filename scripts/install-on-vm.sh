#!/usr/bin/env bash
# Clone or update the repo on Ubuntu, build, install systemd for Twilio bridge.
# Intended for Clawless / similar VMs (Node 20+, user dev). Run from repo root:
#   sudo ./scripts/install-on-vm.sh
# Or one-liner after clone:
#   curl -fsSL ... | sudo bash   # (prefer cloning then running locally).
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

INSTALL_USER="${INSTALL_USER:-dev}"
INSTALL_DIR="${INSTALL_DIR:-/home/${INSTALL_USER}/realtime-phonecalls}"
REPO_URL="${REPO_URL:-https://github.com/RidSib/realtime-phonecalls.git}"
ENV_FILE="${ENV_FILE:-/etc/realtime-voice.env}"
START_SERVICE="${START_SERVICE:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start) START_SERVICE=1 ; shift ;;
    -h|--help)
      sed -n '1,20p' "$0" | tail -n +2
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

run_as_install_user() {
  sudo -u "$INSTALL_USER" env HOME="/home/${INSTALL_USER}" bash -c "$1"
}

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  install -d -o "$INSTALL_USER" -g "$INSTALL_USER" -m 755 "$(dirname "$INSTALL_DIR")"
  run_as_install_user "git clone --depth 1 '$REPO_URL' '$INSTALL_DIR'"
else
  run_as_install_user "cd '$INSTALL_DIR' && git pull --ff-only"
fi

run_as_install_user "cd '$INSTALL_DIR' && npm ci && npm run build"

install -m 644 "$INSTALL_DIR/deploy/systemd/realtime-voice.service" \
  /etc/systemd/system/realtime-voice.service

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$INSTALL_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE — edit REAL keys, especially PUBLIC_URL, then:" >&2
  echo "  sudo systemctl daemon-reload" >&2
  echo "  sudo systemctl enable --now realtime-voice" >&2
else
  echo "Keeping existing $ENV_FILE" >&2
fi

systemctl daemon-reload

if [[ "$START_SERVICE" -eq 1 ]]; then
  systemctl enable --now realtime-voice
  systemctl --no-pager status realtime-voice || true
else
  echo "" >&2
  echo "Next: edit $ENV_FILE, then:" >&2
  echo "  sudo systemctl enable --now realtime-voice" >&2
  echo "Health: curl -sS http://127.0.0.1:5050/health  (default PORT=5050)" >&2
fi
