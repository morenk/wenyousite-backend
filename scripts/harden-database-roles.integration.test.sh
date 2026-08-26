#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-role-hardening-test.XXXXXX")
COMPOSE_FILE="$TEST_ROOT/compose.yml"
ROLES_ENV="$TEST_ROOT/database-roles.env"
BACKUP_FILE="$TEST_ROOT/prechange.dump"
FAKE_BIN="$TEST_ROOT/bin"

cleanup() {
  if [ "${WENYOUSITE_KEEP_FAILED_TEST:-false}" = true ]; then
    echo "保留隔离测试环境供诊断: $TEST_ROOT" >&2
    return
  fi
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/wenyousite-role-hardening-test.*)
      docker compose -f "$COMPOSE_FILE" down --volumes >/dev/null 2>&1 || true
      find "$TEST_ROOT" -depth -delete
      ;;
    *) echo "拒绝清理非测试目录: $TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$FAKE_BIN"
cat >"$COMPOSE_FILE" <<'YAML'
services:
  postgres:
    image: postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
    environment:
      POSTGRES_USER: wenyou
      POSTGRES_PASSWORD: test-only-password
      POSTGRES_DB: wenyousite
    healthcheck:
      test: ["CMD-SHELL", "[ \"$$(cat /proc/1/comm)\" = postgres ] && pg_isready -U wenyou -d wenyousite"]
      interval: 1s
      timeout: 2s
      retries: 90
YAML
cat >"$ROLES_ENV" <<'ENV'
POSTGRES_OWNER_PASSWORD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
POSTGRES_APP_PASSWORD=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
POSTGRES_BACKUP_PASSWORD=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
POSTGRES_MONITOR_PASSWORD=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
ENV
cat >"$FAKE_BIN/systemctl" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = list-unit-files ]; then exit 0; fi
echo "unexpected systemctl call: $*" >&2
exit 1
SH
cat >"$FAKE_BIN/id" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = -u ] && [ "$#" -eq 1 ]; then echo 0; exit 0; fi
exec /usr/bin/id "$@"
SH
chmod 0755 "$FAKE_BIN/systemctl" "$FAKE_BIN/id"

docker compose -f "$COMPOSE_FILE" up -d --wait
container=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
ready=false
for _attempt in $(seq 1 60); do
  if docker exec "$container" psql --no-psqlrc --username wenyou --dbname postgres \
    --tuples-only --no-align --command 'SELECT 1' 2>/dev/null | grep -qx 1; then
    ready=true
    break
  fi
  sleep 1
done
[ "$ready" = true ] || { echo "隔离 PostgreSQL 未就绪" >&2; exit 1; }
docker exec "$container" psql --no-psqlrc --username wenyou --dbname wenyousite \
  --set=ON_ERROR_STOP=1 --command \
  "CREATE EXTENSION pg_trgm; CREATE TYPE public.role_fixture AS ENUM ('ONE'); CREATE TABLE public.role_fixture_table (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind public.role_fixture NOT NULL); CREATE FUNCTION public.role_fixture_function() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'" >/dev/null
docker exec "$container" pg_dump --username wenyou --dbname wenyousite --format=custom >"$BACKUP_FILE"
(cd "$TEST_ROOT" && sha256sum "$(basename -- "$BACKUP_FILE")" >"$(basename -- "$BACKUP_FILE").sha256")
PATH="$FAKE_BIN:$PATH" \
  WENYOUSITE_COMPOSE_FILE="$COMPOSE_FILE" \
  WENYOUSITE_DATABASE_ROLES_ENV="$ROLES_ENV" \
  bash "$SCRIPT_DIR/harden-database-roles.sh" --apply --backup-file "$BACKUP_FILE"
# A failed first activation can be retried after the bootstrap role has already
# become postgres; the hardening entrypoint must therefore be idempotent.
PATH="$FAKE_BIN:$PATH" \
  WENYOUSITE_COMPOSE_FILE="$COMPOSE_FILE" \
  WENYOUSITE_DATABASE_ROLES_ENV="$ROLES_ENV" \
  bash "$SCRIPT_DIR/harden-database-roles.sh" --apply --backup-file "$BACKUP_FILE"

result=$(docker exec --user postgres "$container" psql --no-psqlrc --username postgres \
  --dbname postgres --tuples-only --no-align --field-separator='|' --command \
  "SELECT count(*), count(*) FILTER (WHERE rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) FROM pg_roles WHERE rolname IN ('wenyousite_owner','wenyousite_app','wenyousite_backup','wenyousite_monitor')")
[ "$result" = '4|0' ] || { echo "角色收敛结果错误: $result" >&2; exit 1; }
legacy=$(docker exec --user postgres "$container" psql --no-psqlrc --username postgres \
  --dbname postgres --tuples-only --no-align --command "SELECT count(*) FROM pg_roles WHERE rolname IN ('wenyou','wenyousite_hardener')")
[ "$legacy" = 0 ] || { echo "旧角色或临时 hardener 仍存在" >&2; exit 1; }
owners=$(docker exec --user postgres "$container" psql --no-psqlrc --username postgres \
  --dbname wenyousite --tuples-only --no-align --field-separator='|' --command \
  "SELECT (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname='role_fixture_table'), (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname='role_fixture_table_id_seq'), (SELECT pg_get_userbyid(typowner) FROM pg_type WHERE typname='role_fixture'), (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE proname='role_fixture_function'), (SELECT pg_get_userbyid(extowner) FROM pg_extension WHERE extname='pg_trgm'), has_table_privilege('wenyousite_app', 'public.role_fixture_table', 'SELECT,INSERT,UPDATE,DELETE'), has_table_privilege('wenyousite_backup', 'public.role_fixture_table', 'SELECT'), pg_has_role('wenyousite_backup', 'pg_read_all_data', 'member')")
[ "$owners" = 'wenyousite_owner|wenyousite_owner|wenyousite_owner|wenyousite_owner|postgres|t|t|f' ] || {
  echo "对象 owner/授权收敛错误: $owners" >&2
  exit 1
}
owner_password=$(printf 'a%.0s' {1..64})
app_password=$(printf 'b%.0s' {1..64})
backup_password=$(printf 'c%.0s' {1..64})
docker exec --env "PGPASSWORD=$owner_password" "$container" psql --no-psqlrc --host 127.0.0.1 \
  --username wenyousite_owner --dbname wenyousite --set=ON_ERROR_STOP=1 \
  --command 'CREATE TABLE public.owner_created_fixture (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY)' >/dev/null
docker exec --env "PGPASSWORD=$app_password" "$container" psql --no-psqlrc --host 127.0.0.1 \
  --username wenyousite_app --dbname wenyousite --set=ON_ERROR_STOP=1 \
  --command 'INSERT INTO public.owner_created_fixture DEFAULT VALUES' >/dev/null
if docker exec --env "PGPASSWORD=$app_password" "$container" psql --no-psqlrc --host 127.0.0.1 \
  --username wenyousite_app --dbname wenyousite --set=ON_ERROR_STOP=1 \
  --command 'CREATE TABLE public.app_must_not_create (id integer)' >/dev/null 2>&1; then
  echo "app 角色错误获得 DDL 权限" >&2
  exit 1
fi
docker exec --env "PGPASSWORD=$backup_password" "$container" pg_dump --host 127.0.0.1 \
  --username wenyousite_backup --dbname wenyousite --format=custom >/dev/null
echo "PostgreSQL role hardening integration test passed"
