#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"
OFFSITE_REQUIRED=true
load_restic_environment

LOCK_FILE=${WENYOUSITE_RESTIC_MAINTENANCE_LOCK:-/run/lock/wenyousite-restic-maintenance.lock}
install -d -o root -g root -m 0700 "$(dirname -- "$LOCK_FILE")"
exec 8>"$LOCK_FILE"
flock -n 8 || { echo "已有 restic 维护正在执行" >&2; exit 1; }
acquire_restic_lock

restic forget --tag redis --keep-within 35d --prune
restic forget --tag postgres-logical --keep-within 35d --prune
restic check
record_backup_success restic-maintenance "$RESTIC_REPOSITORY"
echo "restic 35 天保留与仓库一致性检查完成"
