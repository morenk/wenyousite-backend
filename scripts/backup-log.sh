#!/usr/bin/env bash

backup_log_init() {
  BACKUP_OPERATION=$1
  BACKUP_STARTED=$SECONDS
  BACKUP_STAGE=
  BACKUP_LOG_DIR=$(mktemp -d)
  BACKUP_OUTPUT="$BACKUP_LOG_DIR/stdout"
  trap 'backup_log_exit "$?"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  printf 'backup_operation operation=%s event=start\n' "$BACKUP_OPERATION" >&2
}

backup_stage_begin() {
  [ -n "${BACKUP_OPERATION:-}" ] || return 0
  BACKUP_STAGE=$1
  BACKUP_STAGE_STARTED=$SECONDS
  printf 'backup_stage operation=%s stage=%s event=start\n' "$BACKUP_OPERATION" "$BACKUP_STAGE" >&2
}

backup_stage_end() {
  [ -n "${BACKUP_STAGE:-}" ] || return 0
  printf 'backup_stage operation=%s stage=%s event=finish exit_code=%s elapsed_seconds=%s\n' \
    "$BACKUP_OPERATION" "$BACKUP_STAGE" "$1" "$((SECONDS - BACKUP_STAGE_STARTED))" >&2
  BACKUP_STAGE=
}

backup_log_exit() {
  local status=$1
  trap - EXIT
  backup_stage_end "$status"
  if declare -F backup_cleanup >/dev/null; then backup_cleanup || true; fi
  rm -rf -- "${BACKUP_LOG_DIR:?}" || true
  printf 'backup_operation operation=%s event=finish exit_code=%s elapsed_seconds=%s\n' \
    "$BACKUP_OPERATION" "$status" "$((SECONDS - BACKUP_STARTED))" >&2
  exit "$status"
}

# 子命令响应可能包含 URL、凭据或数据路径，仅保留本轮私有文件和稳定阶段/退出码。
backup_run() {
  local stage=$1 status=0
  shift
  backup_stage_begin "$stage"
  "$@" >"$BACKUP_OUTPUT" 2>"$BACKUP_LOG_DIR/stderr" || status=$?
  backup_stage_end "$status"
  return "$status"
}
