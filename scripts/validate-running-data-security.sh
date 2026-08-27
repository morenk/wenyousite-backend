#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}

fail() { echo "运行数据安全验证失败: $*" >&2; exit 1; }
bash "$SCRIPT_DIR/validate-production-security.sh" >/dev/null
set -a
# shellcheck disable=SC1090 -- validated root-owned configuration.
source "$COMPOSE_ENV"
set +a

POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres)
REDIS_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q redis)
for container in "$POSTGRES_CONTAINER" "$REDIS_CONTAINER"; do
  [ -n "$container" ] && [ "$(docker inspect -f '{{.State.Running}}' "$container")" = true ] &&
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")" = healthy ] || fail "容器未健康"
done

mounted_pg_volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$POSTGRES_CONTAINER")
mounted_redis_volume=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$REDIS_CONTAINER")
[ "$mounted_pg_volume" = "$POSTGRES_VOLUME" ] || fail "PostgreSQL 活动卷与 compose.env 不一致"
[ "$mounted_redis_volume" = "$REDIS_VOLUME" ] || fail "Redis 活动卷与 compose.env 不一致"
postgres_secret_mounts=$(docker inspect "$POSTGRES_CONTAINER" | jq -r \
  '.[0].Mounts[] | select(.Destination | startswith("/run/secrets/wenyousite/")) | [.Source, .Destination, .RW] | @tsv' | sort)
expected_postgres_secret_mounts=$(printf '%s\n' \
  "$WENYOUSITE_SECRETS_DIR/pg_hba.conf"$'\t''/run/secrets/wenyousite/pg_hba.conf'$'\t''false' \
  "$WENYOUSITE_SECRETS_DIR/pgbackrest.conf"$'\t''/run/secrets/wenyousite/pgbackrest.conf'$'\t''false' \
  "$WENYOUSITE_SECRETS_DIR/postgres-backup-password"$'\t''/run/secrets/wenyousite/postgres-backup-password'$'\t''false' \
  "$WENYOUSITE_SECRETS_DIR/postgres-owner-password"$'\t''/run/secrets/wenyousite/postgres-owner-password'$'\t''false' | sort)
[ "$postgres_secret_mounts" = "$expected_postgres_secret_mounts" ] || fail "PostgreSQL 密钥挂载未保持逐文件最小暴露"
redis_secret_mounts=$(docker inspect "$REDIS_CONTAINER" | jq -r \
  '.[0].Mounts[] | select(.Destination | startswith("/run/secrets/wenyousite/")) | [.Source, .Destination, .RW] | @tsv' | sort)
expected_redis_secret_mounts=$(printf '%s\n' \
  "$WENYOUSITE_SECRETS_DIR/redis-health-password"$'\t''/run/secrets/wenyousite/redis-health-password'$'\t''false' \
  "$WENYOUSITE_SECRETS_DIR/redis-ops-password"$'\t''/run/secrets/wenyousite/redis-ops-password'$'\t''false' \
  "$WENYOUSITE_SECRETS_DIR/redis-users.acl"$'\t''/run/secrets/wenyousite/redis-users.acl'$'\t''false' | sort)
[ "$redis_secret_mounts" = "$expected_redis_secret_mounts" ] || fail "Redis 密钥挂载未保持逐文件最小暴露"

postgres_settings=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --field-separator='|' --command \
  "SELECT current_setting('archive_mode'), current_setting('archive_timeout'), current_setting('data_checksums'), current_setting('hba_file')")
IFS='|' read -r archive_mode archive_timeout checksum_state hba_file <<<"$postgres_settings"
[ "$archive_mode" = on ] || fail "archive_mode 未开启"
[ "$archive_timeout" = 5min ] || [ "$archive_timeout" = 300s ] || fail "archive_timeout 超过 RPO 预算"
[ "$checksum_state" = on ] || fail "data checksums 未开启"
[ "$hba_file" = /run/secrets/wenyousite/pg_hba.conf ] || fail "PostgreSQL 未使用受控 HBA"

role_violations=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command \
  "SELECT count(*) FROM pg_roles WHERE rolname IN ('wenyousite_owner','wenyousite_app','wenyousite_backup','wenyousite_monitor') AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)")
[ "$role_violations" = 0 ] || fail "业务角色仍有集群级权限"
required_roles=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command \
  "SELECT count(*) FROM pg_roles WHERE rolname IN ('wenyousite_owner','wenyousite_app','wenyousite_backup','wenyousite_monitor') AND rolcanlogin")
[ "$required_roles" = 4 ] || fail "PostgreSQL 专用角色不完整"
role_memberships=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --field-separator='|' --command \
  "SELECT pg_has_role('wenyousite_backup','pg_read_all_data','member'), pg_has_role('wenyousite_monitor','pg_monitor','member')")
[ "$role_memberships" = 'f|t' ] || fail "PostgreSQL backup/monitor 预定义角色成员关系错误"
postgres_admin_state=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --field-separator='|' --command \
  "SELECT rolsuper, rolcanlogin, rolpassword IS NULL FROM pg_authid WHERE rolname='postgres'")
[ "$postgres_admin_state" = 't|t|t' ] || fail "本机 postgres 管理角色属性或无密码约束错误"
legacy_roles=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command \
  "SELECT count(*) FROM pg_roles WHERE rolname = 'wenyou'")
[ "$legacy_roles" = 0 ] || fail "旧 PostgreSQL 超级角色仍存在"
database_owner=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command \
  "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'wenyousite'")
[ "$database_owner" = wenyousite_owner ] || fail "数据库 owner 错误"
object_owner_violations=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname wenyousite --tuples-only --no-align --command \
  "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname='wenyousite_owner')) + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname='wenyousite_owner') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('e','d','r','m') AND t.typowner <> (SELECT oid FROM pg_roles WHERE rolname='wenyousite_owner') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e'))")
[ "$object_owner_violations" = 0 ] || fail "public schema 仍有业务对象不属于 owner"
app_privilege_violations=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname wenyousite --tuples-only --no-align --command \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT has_table_privilege('wenyousite_app', c.oid, 'SELECT,INSERT,UPDATE,DELETE')")
[ "$app_privilege_violations" = 0 ] || fail "app 角色缺少业务表 DML 权限"

pgbackrest_status=$(docker exec --user postgres "$POSTGRES_CONTAINER" pgbackrest \
  --config=/run/secrets/wenyousite/pgbackrest.conf --stanza=wenyousite info --output=json | \
  jq -r '.[0].status.code // -1')
[ "$pgbackrest_status" = 0 ] || fail "pgBackRest stanza 状态异常"
archive_failure_current=$(docker exec --user postgres "$POSTGRES_CONTAINER" psql --no-psqlrc \
  --username postgres --dbname postgres --tuples-only --no-align --command \
  'SELECT NOT COALESCE(last_failed_time <= last_archived_time, true) FROM pg_stat_archiver')
[ "$archive_failure_current" = f ] || fail "最新 WAL 归档仍失败"

# shellcheck source=backup-common.sh
source "$SCRIPT_DIR/backup-common.sh"
redis_persistence=$(redis_cli "$REDIS_CONTAINER" INFO persistence | tr -d '\r')
grep -q '^aof_enabled:1$' <<<"$redis_persistence" || fail "Redis AOF 未开启"
grep -q '^aof_last_write_status:ok$' <<<"$redis_persistence" || fail "Redis AOF 最近写入失败"
redis_acl=$(redis_cli "$REDIS_CONTAINER" ACL LIST)
grep -q '^user default off' <<<"$redis_acl" || fail "Redis default 用户未关闭"
for role in wenyousite_app wenyousite_ops wenyousite_health; do
  grep -q "^user $role on" <<<"$redis_acl" || fail "Redis 缺少 $role"
done

postgres_binding=$(docker inspect -f '{{(index (index .HostConfig.PortBindings "5432/tcp") 0).HostIp}}' "$POSTGRES_CONTAINER")
redis_binding=$(docker inspect -f '{{(index (index .HostConfig.PortBindings "6379/tcp") 0).HostIp}}' "$REDIS_CONTAINER")
[ "$postgres_binding" = 127.0.0.1 ] && [ "$redis_binding" = 127.0.0.1 ] || fail "数据端口不是 loopback 绑定"

if systemctl is-active --quiet wenyousite-backend.service; then
  [ "$(systemctl show -p User --value wenyousite-backend.service)" = wenyousite-backend ] || fail "后端仍以 root 运行"
fi
if systemctl is-active --quiet wenyousite-image-worker.service; then
  [ "$(systemctl show -p User --value wenyousite-image-worker.service)" = wenyousite-backend ] || fail "Worker 仍以 root 运行"
fi
echo "运行数据安全验证通过"
