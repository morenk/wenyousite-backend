#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${WENYOUSITE_COMPOSE_FILE:-$BACKEND_DIR/docker-compose.yml}
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
ROLES_ENV=${WENYOUSITE_DATABASE_ROLES_ENV:-$CONFIG_ROOT/secrets/database-roles.env}
BACKUP_FILE=""
POSTGRES_CONTAINER=""
bootstrap_role=""
hardener_present=false

cleanup_hardener() {
  [ "$hardener_present" = true ] || return 0
  local admin_role=""
  if docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --username postgres \
    --dbname postgres --tuples-only --no-align --command 'SELECT 1' 2>/dev/null | grep -qx 1; then
    admin_role=postgres
  elif [ -n "$bootstrap_role" ] && docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
    --username "$bootstrap_role" --dbname postgres --tuples-only --no-align --command 'SELECT 1' 2>/dev/null | grep -qx 1; then
    admin_role=$bootstrap_role
  fi
  if [ -n "$admin_role" ]; then
    docker exec -i --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --set=ON_ERROR_STOP=1 \
      --username "$admin_role" --dbname postgres --command 'DROP ROLE IF EXISTS wenyousite_hardener' >/dev/null 2>&1 || \
      echo "警告：临时 hardener 角色清理失败；应用保持停止" >&2
  else
    echo "警告：无法连接 PostgreSQL 清理临时 hardener 角色；应用保持停止" >&2
  fi
}
trap cleanup_hardener EXIT

usage() {
  echo "用法: $0 --apply --backup-file /absolute/path/to/verified.dump" >&2
}

if [ "$#" -ne 3 ] || [ "$1" != --apply ] || [ "$2" != --backup-file ]; then
  usage
  exit 2
fi
BACKUP_FILE=$3
[[ "$BACKUP_FILE" = /* && -f "$BACKUP_FILE" && -f "$BACKUP_FILE.sha256" ]] || {
  echo "必须提供已校验逻辑备份及其 SHA-256: $BACKUP_FILE" >&2
  exit 1
}
(cd -- "$(dirname -- "$BACKUP_FILE")" && sha256sum --check --status "$(basename -- "$BACKUP_FILE").sha256") || {
  echo "角色收敛前备份校验失败" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || { echo "角色收敛必须以 root 运行" >&2; exit 1; }
[ -f "$ROLES_ENV" ] || { echo "缺少角色凭据文件: $ROLES_ENV" >&2; exit 1; }

env_value() {
  local key=$1
  awk -v key="$key" -F= '$1 == key { value = substr($0, index($0, "=") + 1); print value; exit }' "$ROLES_ENV"
}
OWNER_PASSWORD=$(env_value POSTGRES_OWNER_PASSWORD)
APP_PASSWORD=$(env_value POSTGRES_APP_PASSWORD)
BACKUP_PASSWORD=$(env_value POSTGRES_BACKUP_PASSWORD)
MONITOR_PASSWORD=$(env_value POSTGRES_MONITOR_PASSWORD)
for password in "$OWNER_PASSWORD" "$APP_PASSWORD" "$BACKUP_PASSWORD" "$MONITOR_PASSWORD"; do
  [[ "$password" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "角色密码必须是 64 位十六进制值" >&2; exit 1; }
done

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
[ -n "$POSTGRES_CONTAINER" ] && [ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER")" = true ] || {
  echo "PostgreSQL 容器未运行" >&2
  exit 1
}
docker exec -i "$POSTGRES_CONTAINER" pg_restore --list <"$BACKUP_FILE" >/dev/null || {
  echo "角色收敛前逻辑备份不是可读取的 custom-format dump" >&2
  exit 1
}

for unit in wenyousite-backend.service wenyousite-image-worker.service; do
  if systemctl list-unit-files "$unit" --no-legend 2>/dev/null | grep -q "^$unit"; then
    systemctl stop "$unit"
  fi
done

bootstrap_role=$(docker exec "$POSTGRES_CONTAINER" sh -eu -c 'printf "%s" "$POSTGRES_USER"')
role_admin=""
if docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --username postgres \
  --dbname postgres --tuples-only --no-align --command 'SELECT 1' 2>/dev/null | grep -qx 1; then
  role_admin=postgres
else
  docker exec -i --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --set=ON_ERROR_STOP=1 \
    --username "$bootstrap_role" --dbname postgres >/dev/null <<'SQL'
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wenyousite_hardener') THEN
    CREATE ROLE wenyousite_hardener LOGIN SUPERUSER CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE wenyousite_hardener LOGIN SUPERUSER CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  ALTER ROLE wenyousite_hardener PASSWORD NULL;
END
$block$;
SQL
  hardener_present=true
  role_admin=wenyousite_hardener
fi

{
  printf '%s\n' '\set ON_ERROR_STOP on'
  printf "\\set owner_password '%s'\n" "$OWNER_PASSWORD"
  printf "\\set app_password '%s'\n" "$APP_PASSWORD"
  printf "\\set backup_password '%s'\n" "$BACKUP_PASSWORD"
  printf "\\set monitor_password '%s'\n" "$MONITOR_PASSWORD"
  cat <<'SQL'
DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wenyou') AND
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER ROLE wenyou RENAME TO postgres;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wenyou') THEN
    RAISE EXCEPTION 'legacy and postgres bootstrap roles both exist; refusing ambiguous hardening';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    RAISE EXCEPTION 'neither legacy nor postgres bootstrap role exists';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wenyousite_owner') THEN
    CREATE ROLE wenyousite_owner LOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wenyousite_app') THEN
    CREATE ROLE wenyousite_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wenyousite_backup') THEN
    CREATE ROLE wenyousite_backup LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wenyousite_monitor') THEN
    CREATE ROLE wenyousite_monitor LOGIN;
  END IF;
END
$block$;

ALTER ROLE postgres WITH LOGIN SUPERUSER CREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL;
ALTER ROLE wenyousite_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'owner_password';
ALTER ROLE wenyousite_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE wenyousite_backup WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'backup_password';
ALTER ROLE wenyousite_monitor WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'monitor_password';

ALTER DATABASE wenyousite OWNER TO wenyousite_owner;
REVOKE CONNECT, TEMPORARY ON DATABASE wenyousite FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE wenyousite TO wenyousite_owner;
GRANT CONNECT ON DATABASE wenyousite TO wenyousite_app, wenyousite_backup, wenyousite_monitor;
SQL
} | docker exec -i --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username "$role_admin" --dbname postgres >/dev/null

docker exec -i --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --username postgres --dbname wenyousite >/dev/null <<'SQL'
SELECT format(
  'ALTER %s %I.%I OWNER TO wenyousite_owner',
  CASE c.relkind
    WHEN 'r' THEN 'TABLE'
    WHEN 'p' THEN 'TABLE'
    WHEN 'S' THEN 'SEQUENCE'
    WHEN 'v' THEN 'VIEW'
    WHEN 'm' THEN 'MATERIALIZED VIEW'
    WHEN 'f' THEN 'FOREIGN TABLE'
  END,
  n.nspname,
  c.relname
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
  AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  AND NOT (
    c.relkind = 'S'
    AND EXISTS (
      SELECT 1
      FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid
        AND d.refclassid = 'pg_class'::regclass
        AND d.deptype IN ('a', 'i')
    )
  )
ORDER BY
  CASE c.relkind WHEN 'r' THEN 1 WHEN 'p' THEN 1 WHEN 'f' THEN 1 ELSE 2 END,
  c.relname
\gexec

SELECT format(
  'ALTER %s %I.%I(%s) OWNER TO wenyousite_owner',
  CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END,
  n.nspname,
  p.proname,
  pg_get_function_identity_arguments(p.oid)
)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
  )
ORDER BY p.proname, p.oid
\gexec

SELECT format('ALTER TYPE %I.%I OWNER TO wenyousite_owner', n.nspname, t.typname)
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
  AND t.typtype IN ('e', 'd', 'r', 'm')
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e'
  )
ORDER BY t.typname
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO wenyousite_owner;
GRANT USAGE ON SCHEMA public TO wenyousite_app, wenyousite_backup, wenyousite_monitor;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wenyousite_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO wenyousite_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO wenyousite_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO wenyousite_backup;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wenyousite_backup;
DO $block$
BEGIN
  IF pg_has_role('wenyousite_backup', 'pg_read_all_data', 'member') THEN
    REVOKE pg_read_all_data FROM wenyousite_backup;
  END IF;
  IF NOT pg_has_role('wenyousite_monitor', 'pg_monitor', 'member') THEN
    GRANT pg_monitor TO wenyousite_monitor;
  END IF;
END
$block$;

ALTER DEFAULT PRIVILEGES FOR ROLE wenyousite_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wenyousite_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wenyousite_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO wenyousite_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wenyousite_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO wenyousite_app;
ALTER DEFAULT PRIVILEGES FOR ROLE wenyousite_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO wenyousite_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE wenyousite_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO wenyousite_backup;

DO $block$
DECLARE
  role_record record;
BEGIN
  FOR role_record IN
    SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('wenyousite_owner', 'wenyousite_app', 'wenyousite_backup', 'wenyousite_monitor')
  LOOP
    IF role_record.rolsuper OR role_record.rolcreatedb OR role_record.rolcreaterole OR
       role_record.rolreplication OR role_record.rolbypassrls THEN
      RAISE EXCEPTION 'role % still has cluster-wide privilege', role_record.rolname;
    END IF;
  END LOOP;
END
$block$;
SQL

docker exec -i --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --username postgres --dbname postgres >/dev/null <<'SQL'
DROP ROLE IF EXISTS wenyousite_hardener;
SQL
hardener_present=false
trap - EXIT

echo "PostgreSQL 角色已收敛；应用/Worker 保持停止，需立即切换安全 Compose 与运行配置。"
