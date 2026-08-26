#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"

BACKUP_DIR="$BACKUP_ROOT/postgres-logical"
LOCK_FILE=${WENYOUSITE_POSTGRES_LOGICAL_LOCK:-/run/lock/wenyousite-postgres-logical.lock}
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="$BACKUP_DIR/wenyousite_postgres_$TIMESTAMP.dump"
TEMP_FILE="$BACKUP_FILE.partial"
SHA_FILE="$BACKUP_FILE.sha256"

install -d -o root -g root -m 0700 "$BACKUP_DIR" "$(dirname -- "$LOCK_FILE")"
exec 8>"$LOCK_FILE"
flock -n 8 || { echo "已有 PostgreSQL 逻辑备份正在执行" >&2; exit 1; }
trap 'if [ -f "$TEMP_FILE" ]; then rm -f -- "$TEMP_FILE"; fi' EXIT

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
if [ -z "$POSTGRES_CONTAINER" ] || [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER")" != true ]; then
  echo "PostgreSQL 容器未运行，拒绝备份" >&2
  exit 1
fi
if [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$POSTGRES_CONTAINER")" != healthy ]; then
  echo "PostgreSQL 容器不健康，拒绝备份" >&2
  exit 1
fi

secure_backup_role=false
if docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --username postgres \
  --dbname postgres --tuples-only --no-align --command \
  "SELECT 1 FROM pg_roles WHERE rolname = 'wenyousite_backup'" 2>/dev/null | grep -qx 1 &&
  docker exec "$POSTGRES_CONTAINER" test -s /run/secrets/wenyousite/postgres-backup-password; then
  secure_backup_role=true
fi

echo "创建 PostgreSQL custom-format 逻辑备份..."
if [ "$secure_backup_role" = true ]; then
  docker exec "$POSTGRES_CONTAINER" sh -eu -c '
    password=$(tr -d "\r\n" </run/secrets/wenyousite/postgres-backup-password)
    [ -n "$password" ]
    PGPASSWORD=$password
    export PGPASSWORD
    exec pg_dump --host 127.0.0.1 --username wenyousite_backup --dbname wenyousite \
      --no-password --format=custom --compress=zstd:6
  ' >"$TEMP_FILE"
elif docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --username postgres \
  --dbname postgres --tuples-only --no-align --command 'SELECT 1' 2>/dev/null | grep -qx 1; then
  # Recovery path for a first activation that hardened roles but failed before
  # the per-file secret mounts were applied.
  docker exec --user postgres "$POSTGRES_CONTAINER" pg_dump --username postgres --dbname wenyousite \
    --format=custom --compress=zstd:6 >"$TEMP_FILE"
else
  legacy_user=$(docker exec "$POSTGRES_CONTAINER" sh -eu -c 'printf "%s" "$POSTGRES_USER"')
  docker exec "$POSTGRES_CONTAINER" pg_dump --username "$legacy_user" --dbname wenyousite \
    --format=custom --compress=zstd:6 >"$TEMP_FILE"
fi

[ "$(stat -c %s "$TEMP_FILE")" -gt 1024 ] || { echo "逻辑备份异常过小" >&2; exit 1; }
docker exec -i "$POSTGRES_CONTAINER" pg_restore --list <"$TEMP_FILE" >/dev/null
mv -- "$TEMP_FILE" "$BACKUP_FILE"
(cd -- "$BACKUP_DIR" && sha256sum "$(basename -- "$BACKUP_FILE")" >"$(basename -- "$SHA_FILE")")
(cd -- "$BACKUP_DIR" && sha256sum --check --status "$(basename -- "$SHA_FILE")")

restic_backup_files postgres-logical "$BACKUP_FILE" "$SHA_FILE"
record_backup_success postgres-logical "$BACKUP_FILE"

find "$BACKUP_DIR" -type f \( -name 'wenyousite_postgres_*.dump' -o -name 'wenyousite_postgres_*.dump.sha256' \) -mtime +7 -delete
trap - EXIT
echo "PostgreSQL 逻辑备份完成: $BACKUP_FILE"
printf 'BACKUP_FILE=%s\n' "$BACKUP_FILE"
