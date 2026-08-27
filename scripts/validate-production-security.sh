#!/usr/bin/env bash
set -euo pipefail

CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
COMPOSE_ENV=${WENYOUSITE_COMPOSE_ENV:-$CONFIG_ROOT/compose.env}
BACKEND_ENV=${WENYOUSITE_BACKEND_ENV:-$CONFIG_ROOT/backend.env}
MIGRATION_ENV=${WENYOUSITE_MIGRATION_ENV:-$CONFIG_ROOT/migration.env}
RESTIC_ENV=${WENYOUSITE_RESTIC_ENV:-$CONFIG_ROOT/restic.env}
ALERTS_ENV=${WENYOUSITE_ALERTS_ENV:-$CONFIG_ROOT/alerts.env}

fail() {
  echo "生产数据安全门禁失败: $*" >&2
  exit 1
}

env_value() {
  local file=$1
  local key=$2
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "=" {
      value = substr($0, index($0, "=") + 1)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
          (substr(value, 1, 1) == "\047" && substr(value, length(value), 1) == "\047")) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' "$file"
}

env_key_count() {
  local file=$1
  local key=$2
  awk -v key="$key" '$0 ~ "^[[:space:]]*" key "=" { count++ } END { print count + 0 }' "$file"
}

config_value() {
  local file=$1
  local key=$2
  awk -F= -v key="$key" '
    $1 == key { count++; value = substr($0, index($0, "=") + 1) }
    END {
      if (count != 1 || value == "") exit 42
      print value
    }
  ' "$file"
}

require_value() {
  local file=$1
  local key=$2
  local value
  [ "$(env_key_count "$file" "$key")" -eq 1 ] || fail "$file 的 $key 必须且只能出现一次"
  value=$(env_value "$file" "$key")
  [ -n "$value" ] || fail "$file 缺少 $key"
  case "$value" in
    *CHANGE_ME*|*change-me*) fail "$file 的 $key 仍是占位值" ;;
  esac
  printf '%s' "$value"
}

require_config_value() {
  local file=$1
  local key=$2
  local value
  value=$(config_value "$file" "$key") || fail "$file 的 $key 必须且只能出现一次且非空"
  case "$value" in
    *CHANGE_ME*|*change-me*) fail "$file 的 $key 仍是占位值" ;;
  esac
  printf '%s' "$value"
}

require_secret_file() {
  local file=$1
  local max_mode=${2:-640}
  [ -f "$file" ] && [ ! -L "$file" ] || fail "缺少实体文件 $file"
  [ "$(stat -c %u "$file")" -eq 0 ] || fail "$file 必须由 root 拥有"
  local mode
  mode=$(stat -c %a "$file")
  if [ "$max_mode" = 600 ]; then
    (( (8#$mode & 8#077) == 0 )) || fail "$file 权限过宽: $mode"
  else
    (( (8#$mode & 8#027) == 0 )) || fail "$file 权限过宽: $mode"
  fi
  if awk '
    /^[[:space:]]*(#|$)/ { next }
    /CHANGE_ME|change-me/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$file"; then
    fail "$file 仍包含占位值"
  fi
}

for command_name in awk docker flock id jq node openssl restic sha256sum sort stat tr wc; do
  command -v "$command_name" >/dev/null 2>&1 || fail "缺少命令 $command_name"
done
backend_groups=$(id -nG wenyousite-backend 2>/dev/null) || fail "缺少 wenyousite-backend 运行用户"
migrator_groups=$(id -nG wenyousite-migrator 2>/dev/null) || fail "缺少 wenyousite-migrator 运行用户"
grep -qw wenyousite-runtime <<<"$backend_groups" || fail "后端用户不属于只读运行组"
grep -qw wenyousite-runtime <<<"$migrator_groups" || fail "迁移用户不属于只读运行组"
! grep -qw wenyousite-secrets <<<"$backend_groups" || fail "后端用户不得属于数据密钥组"
! grep -qw wenyousite-secrets <<<"$migrator_groups" || fail "迁移用户不得属于数据密钥组"
! grep -qw wenyousite-backend <<<"$migrator_groups" || fail "迁移用户不得读取 backend.env"
restic_version=$(restic version | awk 'NR == 1 { print $2 }')
[ -n "$restic_version" ] || fail "无法读取 restic 版本"
[ "$(printf '%s\n' 0.16.4 "$restic_version" | sort -V | head -n 1)" = 0.16.4 ] || fail "restic 版本必须不低于 0.16.4"

require_secret_file "$COMPOSE_ENV" 640
require_secret_file "$BACKEND_ENV" 640
require_secret_file "$MIGRATION_ENV" 640
require_secret_file "$RESTIC_ENV" 600
require_secret_file "$ALERTS_ENV" 600
[ "$(stat -c %G "$BACKEND_ENV")" = wenyousite-backend ] || fail "backend.env 必须只授权应用运行组"
[ "$(stat -c %G "$MIGRATION_ENV")" = wenyousite-migrator ] || fail "migration.env 必须只授权迁移用户"

secrets_dir=$(require_value "$COMPOSE_ENV" WENYOUSITE_SECRETS_DIR)
[ "$secrets_dir" = "$CONFIG_ROOT/secrets" ] || fail "WENYOUSITE_SECRETS_DIR 必须指向 $CONFIG_ROOT/secrets"
[ -d "$secrets_dir" ] && [ ! -L "$secrets_dir" ] || fail "密钥目录必须是实体目录"
[ "$(stat -c %u "$secrets_dir")" -eq 0 ] || fail "密钥目录必须由 root 拥有"
secrets_gid=$(require_value "$COMPOSE_ENV" WENYOUSITE_SECRETS_GID)
[[ "$secrets_gid" =~ ^[0-9]+$ ]] || fail "WENYOUSITE_SECRETS_GID 必须是数字 GID"
[ "$(stat -c %g "$secrets_dir")" = "$secrets_gid" ] || fail "密钥目录 GID 与 compose.env 不一致"
secrets_mode=$(stat -c %a "$secrets_dir")
(( (8#$secrets_mode & 8#027) == 0 )) || fail "密钥目录权限必须不高于 0750"

roles_env="$secrets_dir/database-roles.env"
pgbackrest_config="$secrets_dir/pgbackrest.conf"
pg_hba_config="$secrets_dir/pg_hba.conf"
redis_acl="$secrets_dir/redis-users.acl"
redis_ops_password_file="$secrets_dir/redis-ops-password"
redis_health_password_file="$secrets_dir/redis-health-password"
postgres_owner_password_file="$secrets_dir/postgres-owner-password"
postgres_backup_password_file="$secrets_dir/postgres-backup-password"
for file in "$roles_env" "$pgbackrest_config" "$pg_hba_config" "$redis_acl" \
  "$redis_ops_password_file" "$redis_health_password_file" \
  "$postgres_owner_password_file" "$postgres_backup_password_file"; do
  require_secret_file "$file" 640
  [ "$(stat -c %g "$file")" = "$secrets_gid" ] || fail "$file 的 GID 不允许容器安全读取"
done

[ "$(require_value "$COMPOSE_ENV" POSTGRES_OWNER_USER)" = wenyousite_owner ] || fail "PostgreSQL owner 角色名错误"
[ "$(require_value "$COMPOSE_ENV" POSTGRES_DATABASE)" = wenyousite ] || fail "PostgreSQL 数据库名错误"
[ "$(require_value "$COMPOSE_ENV" POSTGRES_ARCHIVE_MODE)" = on ] || fail "PostgreSQL 连续归档未启用"
[ "$(require_value "$COMPOSE_ENV" POSTGRES_ARCHIVE_TIMEOUT)" = 300s ] || fail "archive_timeout 必须为 300s"
[ "$(require_value "$COMPOSE_ENV" REDIS_HEALTH_USERNAME)" = wenyousite_health ] || fail "Redis 健康角色名错误"
[ "$(require_value "$COMPOSE_ENV" REDIS_OPS_USERNAME)" = wenyousite_ops ] || fail "Redis 运维角色名错误"
for key in POSTGRES_VOLUME REDIS_VOLUME; do
  volume=$(require_value "$COMPOSE_ENV" "$key")
  [[ "$volume" =~ ^wenyousite_[a-z0-9_]+$ ]] || fail "$key 不是受控卷名"
done

[ "$(require_value "$BACKEND_ENV" NODE_ENV)" = production ] || fail "后端 NODE_ENV 必须为 production"
host=$(require_value "$BACKEND_ENV" HOST)
[ "$host" = 127.0.0.1 ] || fail "后端必须监听 IPv4 loopback"
[ "$(require_value "$BACKEND_ENV" PORT)" = 3000 ] || fail "公网后端端口必须为 3000"
database_url=$(require_value "$BACKEND_ENV" DATABASE_URL)
database_url_without_query=${database_url%%\?*}
[[ "$database_url_without_query" == postgresql://wenyousite_app:*@127.0.0.1:5432/wenyousite ]] || fail "DATABASE_URL 必须使用 app 角色、精确数据库名和 loopback"
[ "$(env_key_count "$BACKEND_ENV" DIRECT_DATABASE_URL)" -eq 0 ] || fail "应用运行配置不得包含 owner 直连凭据"
migration_database_url=$(require_value "$MIGRATION_ENV" DATABASE_URL)
direct_database_url=$(require_value "$MIGRATION_ENV" DIRECT_DATABASE_URL)
migration_url_without_query=${migration_database_url%%\?*}
direct_url_without_query=${direct_database_url%%\?*}
[[ "$migration_url_without_query" == postgresql://wenyousite_owner:*@127.0.0.1:5432/wenyousite ]] || fail "migration DATABASE_URL 必须使用 owner 角色和精确数据库名"
[[ "$direct_url_without_query" == postgresql://wenyousite_owner:*@127.0.0.1:5432/wenyousite ]] || fail "DIRECT_DATABASE_URL 必须使用 owner 角色、精确数据库名和 loopback"
[ "$migration_database_url" = "$direct_database_url" ] || fail "迁移的 DATABASE_URL 与 DIRECT_DATABASE_URL 必须一致"
[ "$(require_value "$BACKEND_ENV" REDIS_USERNAME)" = wenyousite_app ] || fail "后端 Redis 角色名错误"
[ "$(require_value "$BACKEND_ENV" REDIS_HOST)" = 127.0.0.1 ] || fail "Redis 必须走 loopback"
[ "$(require_value "$BACKEND_ENV" REDIS_PORT)" = 6379 ] || fail "Redis 端口错误"
[ "$(require_value "$BACKEND_ENV" REDIS_DB)" = 0 ] || fail "Redis DB 必须为 0"
redis_app_password=$(require_value "$BACKEND_ENV" REDIS_PASSWORD)
[[ "$redis_app_password" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Redis app 密码必须是 64 位十六进制值"

declare -a postgres_passwords=()
for key in POSTGRES_OWNER_PASSWORD POSTGRES_APP_PASSWORD POSTGRES_BACKUP_PASSWORD POSTGRES_MONITOR_PASSWORD; do
  password=$(require_value "$roles_env" "$key")
  [[ "$password" =~ ^[0-9a-fA-F]{64}$ ]] || fail "$key 必须是独立的 64 位十六进制密码"
  postgres_passwords+=("$password")
  case "$key" in
    POSTGRES_OWNER_PASSWORD) postgres_owner_password=$password ;;
    POSTGRES_APP_PASSWORD) postgres_app_password=$password ;;
    POSTGRES_BACKUP_PASSWORD) postgres_backup_password=$password ;;
  esac
done
if [ "$(printf '%s\n' "${postgres_passwords[@]}" | sort -u | wc -l)" -ne 4 ]; then
  fail "PostgreSQL 四个角色不得复用密码"
fi
database_url_password=${database_url#postgresql://wenyousite_app:}
database_url_password=${database_url_password%%@*}
migration_url_password=${direct_database_url#postgresql://wenyousite_owner:}
migration_url_password=${migration_url_password%%@*}
[ "$database_url_password" = "$postgres_app_password" ] || fail "应用数据库 URL 与角色密码不一致"
[ "$migration_url_password" = "$postgres_owner_password" ] || fail "迁移 URL 与 owner 角色密码不一致"
mounted_postgres_owner_password=$(tr -d '\r\n' <"$postgres_owner_password_file")
mounted_postgres_backup_password=$(tr -d '\r\n' <"$postgres_backup_password_file")
[ "$mounted_postgres_owner_password" = "$postgres_owner_password" ] || fail "PostgreSQL 初始化密码文件与 owner 角色密码不一致"
[ "$mounted_postgres_backup_password" = "$postgres_backup_password" ] || fail "PostgreSQL 备份密码文件与 backup 角色密码不一致"

redis_ops_password=$(tr -d '\r\n' <"$redis_ops_password_file")
redis_health_password=$(tr -d '\r\n' <"$redis_health_password_file")
for password in "$redis_ops_password" "$redis_health_password"; do
  [[ "$password" =~ ^[0-9a-fA-F]{64}$ ]] || fail "Redis ops/health 密码必须是 64 位十六进制值"
done
[ "$redis_app_password" != "$redis_ops_password" ] && \
  [ "$redis_app_password" != "$redis_health_password" ] && \
  [ "$redis_ops_password" != "$redis_health_password" ] || fail "Redis 三个角色不得复用密码"

redis_app_hash=$(printf '%s' "$redis_app_password" | sha256sum | cut -d' ' -f1)
redis_ops_hash=$(printf '%s' "$redis_ops_password" | sha256sum | cut -d' ' -f1)
redis_health_hash=$(printf '%s' "$redis_health_password" | sha256sum | cut -d' ' -f1)
actual_redis_acl=$(awk 'NF { print }' "$redis_acl")
expected_redis_acl=$(printf '%s\n' \
  'user default reset off' \
  "user wenyousite_app on #$redis_app_hash ~* &* +@all -acl -bgrewriteaof -bgsave -config -debug -flushall -flushdb -migrate -module -monitor -replicaof -restore -save -shutdown -slaveof" \
  "user wenyousite_ops on #$redis_ops_hash ~* &* +@all" \
  "user wenyousite_health on #$redis_health_hash ~* &* +ping")
[ "$actual_redis_acl" = "$expected_redis_acl" ] || fail "Redis ACL 必须精确匹配四行最小权限基线及对应密码哈希"

normalized_hba=$(awk '!/^[[:space:]]*(#|$)/ { gsub(/[[:space:]]+/, " "); sub(/^ /, ""); sub(/ $/, ""); print }' "$pg_hba_config")
expected_hba=$'local all postgres peer\nlocal all all scram-sha-256\nhost wenyousite wenyousite_owner,wenyousite_app,wenyousite_backup,wenyousite_monitor 127.0.0.1/32 scram-sha-256\nhost wenyousite wenyousite_owner,wenyousite_app,wenyousite_backup,wenyousite_monitor ::1/128 scram-sha-256\nhost wenyousite wenyousite_owner,wenyousite_app,wenyousite_backup,wenyousite_monitor 172.16.0.0/12 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject'
[ "$normalized_hba" = "$expected_hba" ] || fail "pg_hba 必须精确匹配 peer/SCRAM/reject 基线"
[ "$(require_config_value "$pgbackrest_config" pg1-path)" = /var/lib/postgresql/data ] || fail "pgBackRest pg1-path 错误"
[ "$(require_config_value "$pgbackrest_config" pg1-socket-path)" = /var/run/postgresql ] || fail "pgBackRest socket path 错误"
[ "$(require_config_value "$pgbackrest_config" repo1-type)" = s3 ] || fail "pgBackRest repo1 必须为 S3"
[ "$(require_config_value "$pgbackrest_config" repo1-cipher-type)" = aes-256-cbc ] || fail "pgBackRest 仓库必须加密"
[ "$(require_config_value "$pgbackrest_config" repo1-retention-full-type)" = time ] || fail "pgBackRest 必须按时间保留"
[ "$(require_config_value "$pgbackrest_config" repo1-retention-full)" = 35 ] || fail "pgBackRest 保留期必须为 35 天"
[ "$(require_config_value "$pgbackrest_config" repo1-storage-verify-tls)" = y ] || fail "pgBackRest 必须校验 TLS"
[ "$(require_config_value "$pgbackrest_config" log-level-file)" = off ] || fail "pgBackRest 容器禁止写未持久化文件日志"
pgbackrest_path=$(require_config_value "$pgbackrest_config" repo1-path)
[ "$pgbackrest_path" = /wenyousite/postgresql ] || fail "pgBackRest 仓库前缀错误"
pgbackrest_bucket=$(require_config_value "$pgbackrest_config" repo1-s3-bucket)
[[ "$pgbackrest_bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "RainS3 bucket 名不合法"
pgbackrest_endpoint=$(require_config_value "$pgbackrest_config" repo1-s3-endpoint)
[[ "$pgbackrest_endpoint" =~ ^[a-z0-9.-]+\.rains3\.com$ ]] || fail "pgBackRest endpoint 必须是 RainS3 域名且不带协议"
pgbackrest_region=$(require_config_value "$pgbackrest_config" repo1-s3-region)
[[ "$pgbackrest_region" =~ ^[a-z0-9-]+$ ]] || fail "RainS3 region 不合法"
[ "$(require_config_value "$pgbackrest_config" repo1-s3-uri-style)" = path ] || fail "RainS3 必须使用 path URI style"
pgbackrest_access_key=$(require_config_value "$pgbackrest_config" repo1-s3-key)
pgbackrest_secret_key=$(require_config_value "$pgbackrest_config" repo1-s3-key-secret)
pgbackrest_cipher_pass=$(require_config_value "$pgbackrest_config" repo1-cipher-pass)
[ "${#pgbackrest_cipher_pass}" -ge 32 ] || fail "pgBackRest 仓库加密口令不得短于 32 字符"

restic_repository=$(require_value "$RESTIC_ENV" RESTIC_REPOSITORY)
expected_restic_repository="s3:https://$pgbackrest_endpoint/$pgbackrest_bucket/wenyousite/restic"
[ "$restic_repository" = "$expected_restic_repository" ] || fail "restic 必须使用同一 RainS3 私有桶的独立前缀"
restic_password_file=$(require_value "$RESTIC_ENV" RESTIC_PASSWORD_FILE)
[ "$restic_password_file" = "$CONFIG_ROOT/restic-password" ] || fail "RESTIC_PASSWORD_FILE 路径错误"
require_secret_file "$restic_password_file" 600
[ -s "$restic_password_file" ] || fail "restic 仓库密码为空"
[ "$(tr -d '\r\n' <"$restic_password_file" | wc -c)" -ge 32 ] || fail "restic 仓库密码不得短于 32 字符"
restic_access_key=$(require_value "$RESTIC_ENV" AWS_ACCESS_KEY_ID)
restic_secret_key=$(require_value "$RESTIC_ENV" AWS_SECRET_ACCESS_KEY)
[ "$restic_access_key" = "$pgbackrest_access_key" ] && [ "$restic_secret_key" = "$pgbackrest_secret_key" ] || fail "pgBackRest 与 restic 必须使用已审查的同一专用 RainS3 凭据"
[ "$(require_value "$RESTIC_ENV" AWS_DEFAULT_REGION)" = "$pgbackrest_region" ] || fail "pgBackRest 与 restic 的 RainS3 region 不一致"

for key in OPS_SMTP_HOST OPS_SMTP_PORT OPS_SMTP_SECURE OPS_SMTP_USER OPS_SMTP_PASS OPS_SMTP_FROM OPS_ALERT_TO; do
  require_value "$ALERTS_ENV" "$key" >/dev/null
done
smtp_port=$(require_value "$ALERTS_ENV" OPS_SMTP_PORT)
[[ "$smtp_port" =~ ^[0-9]+$ ]] && (( smtp_port >= 1 && smtp_port <= 65535 )) || fail "SMTP 端口不合法"
smtp_secure=$(require_value "$ALERTS_ENV" OPS_SMTP_SECURE)
[[ "$smtp_secure" = true || "$smtp_secure" = false ]] || fail "OPS_SMTP_SECURE 只能是 true/false"
for address_key in OPS_SMTP_FROM OPS_ALERT_TO; do
  address=$(require_value "$ALERTS_ENV" "$address_key")
  [[ "$address" == *@* && "$address" != *[[:space:]]* ]] || fail "$address_key 不是可用邮件地址"
done

echo "生产数据安全门禁通过（未输出任何凭据）"
