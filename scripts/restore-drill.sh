#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
start_epoch=$(date +%s)
candidate_id=""
output_file=""
CANDIDATE_DIR=${WENYOUSITE_RESTORE_CANDIDATE_DIR:-/var/lib/wenyousite/restore-candidates}
DEPLOY_LOCK_FILE=${WENYOU_DEPLOY_LOCK_FILE:-/var/lib/wenyousite/deploy.lock}

[ "$(id -u)" -eq 0 ] || { echo "恢复演练必须以 root 运行" >&2; exit 1; }
install -d -o root -g root -m 0700 "$CANDIDATE_DIR"
install -d -o root -g root -m 0755 "$(dirname -- "$DEPLOY_LOCK_FILE")"
exec 7>"$DEPLOY_LOCK_FILE"
flock -n 7 || { echo "部署、恢复切换或另一次演练正在进行" >&2; exit 1; }
cleanup_candidate() {
  if [ -n "$candidate_id" ]; then
    bash "$SCRIPT_DIR/restore-discard.sh" --candidate "$candidate_id" --confirm DELETE_RESTORE_CANDIDATE
  fi
}
cleanup() {
  cleanup_candidate || true
  if [ -n "$output_file" ] && [ -f "$output_file" ]; then
    case "$output_file" in
      "$CANDIDATE_DIR"/.drill-output.*) find "$output_file" -maxdepth 0 -type f -delete ;;
      *) echo "拒绝清理非演练输出: $output_file" >&2 ;;
    esac
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
[ -n "$POSTGRES_CONTAINER" ] || { echo "PostgreSQL 未运行" >&2; exit 1; }
target_utc=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command \
  "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
restore_point="wenyousite_drill_$(date -u +%Y%m%dT%H%M%SZ)"
docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --username postgres \
  --dbname postgres --command "SELECT pg_create_restore_point('$restore_point'); SELECT pg_switch_wal();" >/dev/null
docker exec --user postgres "$POSTGRES_CONTAINER" pgbackrest \
  --config=/run/secrets/wenyousite/pgbackrest.conf --stanza=wenyousite check

output_file=$(mktemp "$CANDIDATE_DIR/.drill-output.XXXXXX")
if ! bash "$SCRIPT_DIR/restore-prepare.sh" --target "$target_utc" \
  --postgres-target-name "$restore_point" | tee "$output_file"; then
  candidate_id=$(awk -F= '$1 == "CANDIDATE_ID" { print $2; exit }' "$output_file")
  exit 1
fi
candidate_id=$(awk -F= '$1 == "CANDIDATE_ID" { print $2; exit }' "$output_file")
find "$output_file" -maxdepth 0 -type f -delete
output_file=""
[[ "$candidate_id" =~ ^[0-9]{8}t[0-9]{6}z_[0-9a-f]{8}$ ]] || { echo "演练未返回候选 ID" >&2; exit 1; }

duration=$(( $(date +%s) - start_epoch ))
cleanup_candidate
candidate_id=""
(( duration <= 7200 )) || { echo "恢复演练超过两小时 RTO: ${duration}s" >&2; exit 1; }

# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"
record_backup_success restore-drill "target=$target_utc,duration_seconds=$duration"
echo "恢复演练完成并删除临时候选: target=$target_utc duration_seconds=$duration"
