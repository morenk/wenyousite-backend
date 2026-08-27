#!/usr/bin/env bash

# Shared by root-owned backup and restore entrypoints. Callers must enable
# `set -euo pipefail` before sourcing this file.
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
RESTIC_ENV=${WENYOUSITE_RESTIC_ENV:-$CONFIG_ROOT/restic.env}
BACKUP_ROOT=${WENYOUSITE_BACKUP_ROOT:-/var/backups/wenyousite}
BACKUP_STATE_DIR=${WENYOUSITE_BACKUP_STATE_DIR:-/var/lib/wenyousite/backup-state}
OFFSITE_REQUIRED=${WENYOUSITE_OFFSITE_REQUIRED:-false}
RESTIC_LOCK_FILE=${WENYOUSITE_RESTIC_LOCK:-/run/lock/wenyousite-restic.lock}
RESTIC_LOCK_WAIT_SECONDS=${WENYOUSITE_RESTIC_LOCK_WAIT_SECONDS:-600}

require_root_owned_private_file() {
  local file=$1
  [ -f "$file" ] && [ ! -L "$file" ] || { echo "缺少实体配置文件: $file" >&2; return 1; }
  [ "$(stat -c %u "$file")" -eq 0 ] || { echo "$file 必须由 root 拥有" >&2; return 1; }
  local mode
  mode=$(stat -c %a "$file")
  (( (8#$mode & 8#077) == 0 )) || { echo "$file 权限必须不高于 0600" >&2; return 1; }
}

load_restic_environment() {
  if [ ! -f "$RESTIC_ENV" ]; then
    if [ "$OFFSITE_REQUIRED" = true ]; then
      echo "异地备份为必需，但缺少 $RESTIC_ENV" >&2
      return 1
    fi
    return 2
  fi
  require_root_owned_private_file "$RESTIC_ENV"
  set -a
  # shellcheck disable=SC1090 -- the root-owned path is validated above.
  source "$RESTIC_ENV"
  set +a
  : "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY 未配置}"
  : "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE 未配置}"
  require_root_owned_private_file "$RESTIC_PASSWORD_FILE"
  [ -s "$RESTIC_PASSWORD_FILE" ] || { echo "restic 密码文件为空" >&2; return 1; }
  command -v restic >/dev/null 2>&1 || { echo "缺少 restic" >&2; return 1; }
}

acquire_restic_lock() {
  [[ "$RESTIC_LOCK_WAIT_SECONDS" =~ ^[0-9]+$ ]] || { echo "restic 锁等待时间非法" >&2; return 1; }
  install -d -o root -g root -m 0700 "$(dirname -- "$RESTIC_LOCK_FILE")"
  exec 9>"$RESTIC_LOCK_FILE"
  flock -w "$RESTIC_LOCK_WAIT_SECONDS" 9 || { echo "等待共享 restic 仓库锁超时" >&2; return 1; }
}

restic_backup_files() {
  local tag=$1
  shift
  if load_restic_environment; then
    acquire_restic_lock
    restic backup --quiet --host wenyousite --tag "$tag" -- "$@"
  else
    local status=$?
    [ "$status" -eq 2 ] || return "$status"
    echo "未配置 restic；仅保留本机备份（开发模式）" >&2
  fi
}

record_backup_success() {
  local kind=$1
  local artifact=$2
  install -d -o root -g root -m 0700 "$BACKUP_STATE_DIR"
  local temp_file
  temp_file=$(mktemp "$BACKUP_STATE_DIR/.${kind}.XXXXXX")
  {
    printf 'completed_epoch=%s\n' "$(date +%s)"
    printf 'completed_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'artifact=%s\n' "$artifact"
  } >"$temp_file"
  chmod 0600 "$temp_file"
  mv -f -- "$temp_file" "$BACKUP_STATE_DIR/$kind.success"
}

redis_cli() {
  local container=$1
  shift
  docker exec "$container" sh -eu -c '
    if [ -s /run/secrets/wenyousite/redis-ops-password ]; then
      REDISCLI_AUTH=$(tr -d "\r\n" </run/secrets/wenyousite/redis-ops-password)
      export REDISCLI_AUTH
    fi
    exec redis-cli --user "${REDIS_OPS_USERNAME:-default}" --no-auth-warning --raw "$@"
  ' redis-cli "$@"
}
