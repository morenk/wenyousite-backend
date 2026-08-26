#!/usr/bin/env bash
set -euo pipefail
umask 077

unit=${1:-}
[[ "$unit" =~ ^[a-zA-Z0-9@_.-]+$ ]] || { echo "非法 systemd unit 名" >&2; exit 2; }
RUNTIME_ROOT=${WENYOUSITE_RUNTIME_ROOT:-/var/lib/wenyousite/backend/current}
STATE_DIR=${WENYOUSITE_ALERT_STATE_DIR:-/var/lib/wenyousite/backup-state/alerts}
COOLDOWN_SECONDS=${WENYOUSITE_ALERT_COOLDOWN_SECONDS:-3600}
NODE_BINARY=${WENYOUSITE_NODE_BINARY:-$RUNTIME_ROOT/bin/node}
ALERT_SCRIPT=${WENYOUSITE_ALERT_SCRIPT:-$RUNTIME_ROOT/scripts/send-backup-alert.mjs}

[ -x "$NODE_BINARY" ] || { echo "告警 Node 运行时不存在" >&2; exit 1; }
[ -f "$ALERT_SCRIPT" ] || { echo "告警脚本不存在" >&2; exit 1; }
install -d -o root -g root -m 0700 "$STATE_DIR"
exec 8>"$STATE_DIR/$unit.lock"
flock -n 8 || exit 0

last_sent=0
if [ -f "$STATE_DIR/$unit.sent" ]; then
  last_sent=$(<"$STATE_DIR/$unit.sent")
  [[ "$last_sent" =~ ^[0-9]+$ ]] || last_sent=0
fi
now=$(date +%s)
if (( now - last_sent < COOLDOWN_SECONDS )); then
  echo "告警处于冷却期: $unit"
  exit 0
fi

body_file=$(mktemp "$STATE_DIR/.body.XXXXXX")
trap 'if [ -f "$body_file" ]; then rm -f -- "$body_file"; fi' EXIT
{
  printf 'unit=%s\n' "$unit"
  printf 'host=%s\n' "$(hostname)"
  printf 'detected_utc=%s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  systemctl status "$unit" --no-pager --lines=30 2>&1 || true
  printf '\nrecent journal:\n'
  journalctl -u "$unit" --since '-30 minutes' --no-pager -n 120 2>&1 || true
} >"$body_file"

"$NODE_BINARY" "$ALERT_SCRIPT" "$unit" <"$body_file"
sent_temp=$(mktemp "$STATE_DIR/.sent.XXXXXX")
printf '%s\n' "$now" >"$sent_temp"
chmod 0600 "$sent_temp"
mv -f -- "$sent_temp" "$STATE_DIR/$unit.sent"
