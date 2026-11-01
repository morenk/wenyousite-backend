#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"
backup_log_init restic-maintenance
OFFSITE_REQUIRED=true
load_restic_environment
APPROVAL_FILE="$CONFIG_ROOT/restic-retention-approval.json"

case "${1:-}" in
  --dry-run)
    [ "$#" -eq 1 ] || exit 2
    backup_run retention_review python3 "$SCRIPT_DIR/restic-retention.py" plan
    cat -- "$BACKUP_OUTPUT"
    exit 0
    ;;
  --activate-reviewed)
    [ "$#" -eq 4 ] && [ "$3" = --confirm ] && [ "$4" = ENABLE_WENYOUSITE_RETENTION_V1 ] || exit 2
    [ "$(id -u)" -eq 0 ] || exit 1
    require_root_owned_private_file "$2"
    backup_run retention_activation python3 "$SCRIPT_DIR/restic-retention.py" activate --plan "$2" --approval "$APPROVAL_FILE"
    exit 0
    ;;
  '') ;;
  *) exit 2 ;;
esac

LOCK_FILE=${WENYOUSITE_RESTIC_MAINTENANCE_LOCK:-/run/lock/wenyousite-restic-maintenance.lock}
install -d -o root -g root -m 0700 "$(dirname -- "$LOCK_FILE")"
exec 8>"$LOCK_FILE"
flock -n 8 || { echo "已有 restic 维护正在执行" >&2; exit 1; }
install -d -o root -g root -m 0700 "$(dirname -- "$RESTIC_LOCK_FILE")" "$(dirname -- "$RESTIC_INTENT_LOCK")"

maintenance_phase() {
  local stage=$1 status=0
  shift
  exec 9>"$RESTIC_LOCK_FILE"
  backup_stage_begin restic_lock_wait
  if ! flock -n 9; then
    backup_stage_end 75
    exec 9>&-
    printf 'maintenance_deferred stage=%s reason=repository_busy\n' "$stage"
    return 75
  fi
  backup_stage_end 0
  backup_run "$stage" python3 "$SCRIPT_DIR/restic-maintenance-phase.py" \
    --intent-lock "$RESTIC_INTENT_LOCK" --budget "${WENYOUSITE_MAINTENANCE_PHASE_SECONDS:-540}" \
    --grace "${WENYOUSITE_MAINTENANCE_GRACE_SECONDS:-30}" -- "$@" || status=$?
  exec 9>&-
  case "$status" in
    75) printf 'maintenance_deferred stage=%s reason=backup_pending\n' "$stage" ;;
    78) printf 'maintenance_deferred stage=%s reason=phase_budget\n' "$stage" ;;
    76) printf 'maintenance_failure stage=%s reason=forced_termination_native_lock_may_remain\n' "$stage" >&2 ;;
  esac
  return "$status"
}

run_phase_or_defer() {
  local status=0
  maintenance_phase "$@" || status=$?
  case "$status" in
    75|78) exit 0 ;; # 仅延期，不更新维护成功时间；巡检仍会检查维护逾期。
    0) ;;
    *) exit "$status" ;;
  esac
}

recent_success() {
  local file="$BACKUP_STATE_DIR/$1.success" epoch artifact now
  [ -f "$file" ] || return 1
  epoch=$(awk -F= '$1 == "completed_epoch" {print $2}' "$file")
  artifact=$(awk -F= '$1 == "artifact" {print $2}' "$file")
  now=$(date +%s)
  [[ "$epoch" =~ ^[0-9]+$ ]] && [ "$artifact" = "$2" ] &&
    (( now >= epoch && now - epoch < 86400 ))
}

checkpoint_phase() {
  local phase=$1
  shift
  if recent_success "restic-phase-$phase" "$policy_hash"; then return 0; fi
  run_phase_or_defer "$phase" "$@"
  record_backup_success "restic-phase-$phase" "$policy_hash"
}

if [ -e "$APPROVAL_FILE" ]; then
  require_root_owned_private_file "$APPROVAL_FILE"
  policy_hash=$(sha256sum "$APPROVAL_FILE" | cut -d' ' -f1)
  if recent_success restic-maintenance "$policy_hash"; then exit 0; fi
  checkpoint_phase forget python3 "$SCRIPT_DIR/restic-retention.py" apply --approval "$APPROVAL_FILE"
  checkpoint_phase prune restic prune --quiet --max-repack-size 256M
  checkpoint_phase check restic check --quiet --with-cache
  record_backup_success restic-maintenance "$policy_hash"
  printf 'maintenance_complete retention=enabled\n'
else
  if recent_success restic-check check-only; then exit 0; fi
  run_phase_or_defer check restic check --quiet --with-cache
  record_backup_success restic-check check-only
  printf 'maintenance_deferred reason=retention_review_required\n'
fi
