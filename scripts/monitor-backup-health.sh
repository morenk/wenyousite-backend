#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
STATE_DIR=${WENYOUSITE_BACKUP_STATE_DIR:-/var/lib/wenyousite/backup-state}
now=$(date +%s)
errors=()
monitor_started=$SECONDS

check_stamp() {
  local kind=$1
  local max_age=$2
  local file="$STATE_DIR/$kind.success"
  if [ ! -f "$file" ]; then
    errors+=("missing_stamp=$kind")
    return
  fi
  local completed
  completed=$(awk -F= '$1 == "completed_epoch" { print $2; exit }' "$file")
  if [[ ! "$completed" =~ ^[0-9]+$ ]]; then
    errors+=("invalid_stamp=$kind")
  elif (( now - completed > max_age )); then
    errors+=("stale_${kind}_seconds=$((now - completed))")
  fi
}

[ -f "$STATE_DIR/security-activated" ] || errors+=("security_activation_marker=missing")
check_stamp redis 900
check_stamp pgbackrest 108000
check_stamp postgres-logical 108000
check_stamp restic-maintenance 108000
check_stamp restore-drill 8640000

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres 2>/dev/null || true)
if [ -z "$POSTGRES_CONTAINER" ] || [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)" != true ]; then
  errors+=("postgres=not_running")
else
  settings=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --username postgres \
    --dbname postgres --tuples-only --no-align --field-separator='|' --command \
    "SELECT current_setting('archive_mode'), current_setting('archive_timeout'), current_setting('data_checksums'), failed_count, COALESCE(last_failed_time <= last_archived_time, true) FROM pg_stat_archiver" 2>/dev/null || true)
  IFS='|' read -r archive_mode archive_timeout data_checksums _failed_count archive_recovered <<<"$settings"
  [ "$archive_mode" = on ] || errors+=("postgres_archive_mode=${archive_mode:-unknown}")
  [ "$archive_timeout" = 5min ] || [ "$archive_timeout" = 300s ] || errors+=("postgres_archive_timeout=${archive_timeout:-unknown}")
  [ "$data_checksums" = on ] || errors+=("postgres_data_checksums=${data_checksums:-unknown}")
  [ "$archive_recovered" = t ] || errors+=("postgres_latest_archive=failed")
  diagnostics_dir=$(mktemp -d)
  trap 'rm -rf -- "$diagnostics_dir"' EXIT
  pgbackrest_started=$SECONDS
  printf 'backup_health_check stage=pgbackrest_info event=start\n'
  pgbackrest_exit=0
  docker exec --user postgres "$POSTGRES_CONTAINER" pgbackrest \
    --config=/run/secrets/wenyousite/pgbackrest.conf --stanza=wenyousite info --output=json \
    >"$diagnostics_dir/info" 2>"$diagnostics_dir/stderr" || pgbackrest_exit=$?
  pgbackrest_elapsed=$((SECONDS - pgbackrest_started))
  printf 'backup_health_check stage=pgbackrest_info event=finish exit_code=%s elapsed_seconds=%s\n' \
    "$pgbackrest_exit" "$pgbackrest_elapsed"
  if pgbackrest_diagnostics=$(jq -cn --rawfile info "$diagnostics_dir/info" \
    --rawfile stderr "$diagnostics_dir/stderr" -f "$SCRIPT_DIR/backup-health-diagnostics.jq" 2>/dev/null); then
    if [ "$pgbackrest_exit" -ne 0 ] || ! jq -e '.healthy' <<<"$pgbackrest_diagnostics" >/dev/null; then
      errors+=("stage=pgbackrest_info exit_code=$pgbackrest_exit stage_elapsed_seconds=$pgbackrest_elapsed diagnostics=$pgbackrest_diagnostics")
    fi
  else
    errors+=("stage=pgbackrest_info exit_code=$pgbackrest_exit stage_elapsed_seconds=$pgbackrest_elapsed diagnostics=formatter_failed")
  fi
  rm -rf -- "$diagnostics_dir"
  trap - EXIT
fi

REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis 2>/dev/null || true)
if [ -z "$REDIS_CONTAINER" ] || [ "$(docker inspect -f '{{.State.Running}}' "$REDIS_CONTAINER" 2>/dev/null || true)" != true ]; then
  errors+=("redis=not_running")
else
  # shellcheck source=backup-common.sh
  source "$SCRIPT_DIR/backup-common.sh"
  redis_persistence=$(redis_cli "$REDIS_CONTAINER" INFO persistence 2>/dev/null | tr -d '\r' || true)
  grep -q '^aof_enabled:1$' <<<"$redis_persistence" || errors+=("redis_aof=disabled")
  grep -q '^aof_last_write_status:ok$' <<<"$redis_persistence" || errors+=("redis_aof_write=failed")
fi

if [ "${#errors[@]}" -gt 0 ]; then
  printf 'backup_health_failure elapsed_seconds=%s %s\n' "$((SECONDS - monitor_started))" "${errors[*]}" >&2
  exit 1
fi
printf 'backup_health_success elapsed_seconds=%s\n' "$((SECONDS - monitor_started))"
