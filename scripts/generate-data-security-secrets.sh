#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
CONFIG_ROOT=${WENYOUSITE_CONFIG_ROOT:-/etc/wenyousite}
SECRETS_DIR="$CONFIG_ROOT/secrets"
SOURCE_ENV=${WENYOUSITE_SOURCE_ENV:-$BACKEND_DIR/.env}
RECOVERY_FILE=${WENYOUSITE_RECOVERY_FILE:-/root/wenyousite-data-security-recovery.txt}
APP_USER=${WENYOUSITE_APP_USER:-wenyousite-backend}
MIGRATOR_USER=${WENYOUSITE_MIGRATOR_USER:-wenyousite-migrator}
SECRETS_GROUP=${WENYOUSITE_SECRETS_GROUP:-wenyousite-secrets}
FILE_OWNER=${WENYOUSITE_FILE_OWNER:-root}
PRIVATE_GROUP=${WENYOUSITE_PRIVATE_GROUP:-root}
TEST_MODE=${WENYOUSITE_SECRET_GENERATION_TEST_MODE:-false}
STAGING_DIR=""

fail() {
  echo "内部数据密钥生成失败: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
    case "$STAGING_DIR" in
      "$CONFIG_ROOT"/.secret-generation.*) find "$STAGING_DIR" -depth -delete ;;
      *) echo "拒绝清理非受控密钥暂存目录: $STAGING_DIR" >&2 ;;
    esac
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[ "$#" -eq 1 ] && [ "$1" = --apply ] || {
  echo "用法: $0 --apply" >&2
  exit 2
}
[ "$TEST_MODE" = true ] || [ "$TEST_MODE" = false ] || fail "测试模式只能是 true/false"
if [ "$(id -u)" -ne 0 ]; then
  [ "$TEST_MODE" = true ] || fail "必须以 root 运行"
  test_sandbox=${CONFIG_ROOT%/etc/wenyousite}
  [ "$CONFIG_ROOT" = "$test_sandbox/etc/wenyousite" ] || fail "测试配置根目录格式错误"
  case "$test_sandbox" in
    "${TMPDIR:-/tmp}"/wenyousite-secret-generation.*) ;;
    *) fail "非 root 测试只能使用受控临时目录" ;;
  esac
  case "$SOURCE_ENV" in "$test_sandbox"/*) ;; *) fail "测试源环境文件逃逸临时目录" ;; esac
  case "$RECOVERY_FILE" in "$test_sandbox"/*) ;; *) fail "测试恢复文件逃逸临时目录" ;; esac
  [ "$FILE_OWNER" = "$(id -un)" ] || fail "非 root 测试只能写当前用户文件"
  [ "$APP_USER" = "$FILE_OWNER" ] && [ "$MIGRATOR_USER" = "$FILE_OWNER" ] || fail "非 root 测试用户不一致"
  [ "$SECRETS_GROUP" = "$(id -gn)" ] && [ "$PRIVATE_GROUP" = "$SECRETS_GROUP" ] || fail "非 root 测试组不一致"
fi
for command_name in awk chmod cut find getent grep install mktemp openssl sha256sum sort stat tr wc; do
  command -v "$command_name" >/dev/null 2>&1 || fail "缺少命令 $command_name"
done
getent passwd "$APP_USER" >/dev/null || fail "缺少应用用户 $APP_USER；先运行 provision-data-security.sh"
getent passwd "$MIGRATOR_USER" >/dev/null || fail "缺少迁移用户 $MIGRATOR_USER；先运行 provision-data-security.sh"
getent passwd "$FILE_OWNER" >/dev/null || fail "缺少文件 owner $FILE_OWNER"
getent group "$SECRETS_GROUP" >/dev/null || fail "缺少密钥组 $SECRETS_GROUP；先运行 provision-data-security.sh"
getent group "$PRIVATE_GROUP" >/dev/null || fail "缺少私有文件组 $PRIVATE_GROUP"

[ -f "$SOURCE_ENV" ] && [ ! -L "$SOURCE_ENV" ] || fail "缺少实体应用环境文件 $SOURCE_ENV"
[ "$(stat -c %u "$SOURCE_ENV")" -eq "$(id -u "$FILE_OWNER")" ] || fail "$SOURCE_ENV owner 必须是 $FILE_OWNER"
source_mode=$(stat -c %a "$SOURCE_ENV")
(( (8#$source_mode & 8#022) == 0 )) || fail "$SOURCE_ENV 不得允许 group/world 写入"

duplicate_keys=$(awk -F= '
  /^[[:space:]]*(#|$)/ { next }
  /^[A-Za-z_][A-Za-z0-9_]*=/ { count[$1]++ }
  END { for (key in count) if (count[key] != 1) print key }
' "$SOURCE_ENV" | sort)
[ -z "$duplicate_keys" ] || fail "$SOURCE_ENV 包含重复键: $(tr '\n' ' ' <<<"$duplicate_keys")"
unsafe_keys=$(awk -F= '
  /^[[:space:]]*(#|$)/ { next }
  !/^[A-Za-z_][A-Za-z0-9_]*=/ { print "line-" NR; next }
  {
    value = substr($0, index($0, "=") + 1)
    if (value !~ /^[A-Za-z0-9_./:@?+=,%-]*$/) print $1
  }
' "$SOURCE_ENV" | sort -u)
[ -z "$unsafe_keys" ] || fail "$SOURCE_ENV 含不能安全迁入 systemd EnvironmentFile 的键: $(tr '\n' ' ' <<<"$unsafe_keys")"
placeholder_keys=$(awk -F= '
  /^[[:space:]]*(#|$)/ { next }
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    value = substr($0, index($0, "=") + 1)
    if (value ~ /CHANGE_ME|change-me/) print $1
  }
' "$SOURCE_ENV" | sort -u)
[ -z "$placeholder_keys" ] || fail "$SOURCE_ENV 仍包含占位值: $(tr '\n' ' ' <<<"$placeholder_keys")"

env_value() {
  local key=$1
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$SOURCE_ENV"
}
for key in SES_SMTP_HOST SES_SMTP_PORT SES_SMTP_USER SES_SMTP_PASS SES_FROM_ADDRESS; do
  [ -n "$(env_value "$key")" ] || fail "$SOURCE_ENV 缺少 $key"
done

roles_env="$SECRETS_DIR/database-roles.env"
pgbackrest_config="$SECRETS_DIR/pgbackrest.conf"
redis_acl="$SECRETS_DIR/redis-users.acl"
redis_ops_password_file="$SECRETS_DIR/redis-ops-password"
redis_health_password_file="$SECRETS_DIR/redis-health-password"
postgres_owner_password_file="$SECRETS_DIR/postgres-owner-password"
postgres_backup_password_file="$SECRETS_DIR/postgres-backup-password"
backend_env="$CONFIG_ROOT/backend.env"
migration_env="$CONFIG_ROOT/migration.env"
compose_env="$CONFIG_ROOT/compose.env"
alerts_env="$CONFIG_ROOT/alerts.env"
restic_password_file="$CONFIG_ROOT/restic-password"

for required_file in "$roles_env" "$pgbackrest_config" "$redis_acl" \
  "$redis_ops_password_file" "$redis_health_password_file" \
  "$postgres_owner_password_file" "$postgres_backup_password_file" \
  "$backend_env" "$migration_env" "$compose_env" "$alerts_env" \
  "$restic_password_file"; do
  [ -f "$required_file" ] && [ ! -L "$required_file" ] || fail "缺少 provision 生成的实体文件 $required_file"
done
[ ! -e "$RECOVERY_FILE" ] || fail "恢复清单已存在，拒绝覆盖: $RECOVERY_FILE"
[ ! -s "$backend_env" ] || fail "$backend_env 已有内容，拒绝覆盖"
[ ! -s "$redis_ops_password_file" ] || fail "$redis_ops_password_file 已有内容，拒绝覆盖"
[ ! -s "$redis_health_password_file" ] || fail "$redis_health_password_file 已有内容，拒绝覆盖"
[ ! -s "$postgres_owner_password_file" ] || fail "$postgres_owner_password_file 已有内容，拒绝覆盖"
[ ! -s "$postgres_backup_password_file" ] || fail "$postgres_backup_password_file 已有内容，拒绝覆盖"
[ ! -s "$restic_password_file" ] || fail "$restic_password_file 已有内容，拒绝覆盖"
grep -q '^WENYOUSITE_SECRETS_GID=CHANGE_ME_NUMERIC_GID$' "$compose_env" || fail "compose.env 不是未初始化模板"
grep -q '^POSTGRES_OWNER_PASSWORD=CHANGE_ME_RANDOM_HEX$' "$roles_env" || fail "database-roles.env 不是未初始化模板"
grep -q '^DATABASE_URL=postgresql://wenyousite_owner:CHANGE_ME_URL_ENCODED_PASSWORD@' "$migration_env" || fail "migration.env 不是未初始化模板"
grep -q '^repo1-cipher-pass=CHANGE_ME_RANDOM_ENCRYPTION_PASSPHRASE$' "$pgbackrest_config" || fail "pgbackrest.conf 不是未初始化模板"
grep -q '^user wenyousite_app on #SHA256_APP_PASSWORD ' "$redis_acl" || fail "redis-users.acl 不是未初始化模板"
grep -q '^OPS_ALERT_TO=CHANGE_ME_ALERT_RECIPIENT$' "$alerts_env" || fail "alerts.env 不是未初始化模板"

random_hex() { openssl rand -hex 32; }
postgres_owner_password=$(random_hex)
postgres_app_password=$(random_hex)
postgres_backup_password=$(random_hex)
postgres_monitor_password=$(random_hex)
redis_app_password=$(random_hex)
redis_ops_password=$(random_hex)
redis_health_password=$(random_hex)
pgbackrest_cipher_pass=$(random_hex)
restic_password=$(random_hex)
secret_count=$(printf '%s\n' \
  "$postgres_owner_password" "$postgres_app_password" "$postgres_backup_password" \
  "$postgres_monitor_password" "$redis_app_password" "$redis_ops_password" \
  "$redis_health_password" "$pgbackrest_cipher_pass" "$restic_password" | sort -u | wc -l)
[ "$secret_count" -eq 9 ] || fail "随机源生成了重复口令"
redis_app_hash=$(printf '%s' "$redis_app_password" | sha256sum | cut -d' ' -f1)
redis_ops_hash=$(printf '%s' "$redis_ops_password" | sha256sum | cut -d' ' -f1)
redis_health_hash=$(printf '%s' "$redis_health_password" | sha256sum | cut -d' ' -f1)
secrets_gid=$(getent group "$SECRETS_GROUP" | cut -d: -f3)
[[ "$secrets_gid" =~ ^[0-9]+$ ]] || fail "无法解析 $SECRETS_GROUP 的 GID"

STAGING_DIR=$(mktemp -d "$CONFIG_ROOT/.secret-generation.XXXXXX")
chmod 0700 "$STAGING_DIR"

awk '
  /^[[:space:]]*(NODE_ENV|HOST|PORT|DATABASE_URL|DIRECT_DATABASE_URL|REDIS_HOST|REDIS_PORT|REDIS_DB|REDIS_USERNAME|REDIS_PASSWORD)=/ { next }
  { print }
' "$SOURCE_ENV" >"$STAGING_DIR/backend.env"
{
  printf 'NODE_ENV=production\n'
  printf 'HOST=127.0.0.1\n'
  printf 'PORT=3000\n'
  printf 'DATABASE_URL=postgresql://wenyousite_app:%s@127.0.0.1:5432/wenyousite?schema=public\n' "$postgres_app_password"
  printf 'REDIS_HOST=127.0.0.1\n'
  printf 'REDIS_PORT=6379\n'
  printf 'REDIS_DB=0\n'
  printf 'REDIS_USERNAME=wenyousite_app\n'
  printf 'REDIS_PASSWORD=%s\n' "$redis_app_password"
} >>"$STAGING_DIR/backend.env"

{
  printf 'DATABASE_URL=postgresql://wenyousite_owner:%s@127.0.0.1:5432/wenyousite?schema=public\n' "$postgres_owner_password"
  printf 'DIRECT_DATABASE_URL=postgresql://wenyousite_owner:%s@127.0.0.1:5432/wenyousite?schema=public\n' "$postgres_owner_password"
} >"$STAGING_DIR/migration.env"

{
  printf 'POSTGRES_OWNER_PASSWORD=%s\n' "$postgres_owner_password"
  printf 'POSTGRES_APP_PASSWORD=%s\n' "$postgres_app_password"
  printf 'POSTGRES_BACKUP_PASSWORD=%s\n' "$postgres_backup_password"
  printf 'POSTGRES_MONITOR_PASSWORD=%s\n' "$postgres_monitor_password"
} >"$STAGING_DIR/database-roles.env"

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    WENYOUSITE_SECRETS_GID=CHANGE_ME_NUMERIC_GID) printf 'WENYOUSITE_SECRETS_GID=%s\n' "$secrets_gid" ;;
    *) printf '%s\n' "$line" ;;
  esac
done <"$compose_env" >"$STAGING_DIR/compose.env"

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    repo1-cipher-pass=CHANGE_ME_RANDOM_ENCRYPTION_PASSPHRASE) printf 'repo1-cipher-pass=%s\n' "$pgbackrest_cipher_pass" ;;
    *) printf '%s\n' "$line" ;;
  esac
done <"$pgbackrest_config" >"$STAGING_DIR/pgbackrest.conf"

{
  printf 'user default reset off\n'
  printf 'user wenyousite_app on #%s ~* &* +@all -acl -bgrewriteaof -bgsave -config -debug -flushall -flushdb -migrate -module -monitor -replicaof -restore -save -shutdown -slaveof\n' "$redis_app_hash"
  printf 'user wenyousite_ops on #%s ~* &* +@all\n' "$redis_ops_hash"
  printf 'user wenyousite_health on #%s ~* &* +ping\n' "$redis_health_hash"
} >"$STAGING_DIR/redis-users.acl"

smtp_host=$(env_value SES_SMTP_HOST)
smtp_port=$(env_value SES_SMTP_PORT)
smtp_user=$(env_value SES_SMTP_USER)
smtp_pass=$(env_value SES_SMTP_PASS)
smtp_from=$(env_value SES_FROM_ADDRESS)
smtp_secure=false
[ "$smtp_port" = 465 ] && smtp_secure=true
{
  printf 'OPS_SMTP_HOST=%s\n' "$smtp_host"
  printf 'OPS_SMTP_PORT=%s\n' "$smtp_port"
  printf 'OPS_SMTP_SECURE=%s\n' "$smtp_secure"
  printf 'OPS_SMTP_USER=%s\n' "$smtp_user"
  printf 'OPS_SMTP_PASS=%s\n' "$smtp_pass"
  printf 'OPS_SMTP_FROM=%s\n' "$smtp_from"
  printf 'OPS_ALERT_TO=CHANGE_ME_ALERT_RECIPIENT\n'
} >"$STAGING_DIR/alerts.env"

printf '%s\n' "$postgres_owner_password" >"$STAGING_DIR/postgres-owner-password"
printf '%s\n' "$postgres_backup_password" >"$STAGING_DIR/postgres-backup-password"
printf '%s\n' "$redis_ops_password" >"$STAGING_DIR/redis-ops-password"
printf '%s\n' "$redis_health_password" >"$STAGING_DIR/redis-health-password"
printf '%s\n' "$restic_password" >"$STAGING_DIR/restic-password"
{
  printf '# Wenyou Site data-security recovery credentials\n'
  printf '# Copy into the offline password manager before activation.\n'
  printf 'POSTGRES_OWNER_PASSWORD=%s\n' "$postgres_owner_password"
  printf 'POSTGRES_APP_PASSWORD=%s\n' "$postgres_app_password"
  printf 'POSTGRES_BACKUP_PASSWORD=%s\n' "$postgres_backup_password"
  printf 'POSTGRES_MONITOR_PASSWORD=%s\n' "$postgres_monitor_password"
  printf 'REDIS_APP_PASSWORD=%s\n' "$redis_app_password"
  printf 'REDIS_OPS_PASSWORD=%s\n' "$redis_ops_password"
  printf 'REDIS_HEALTH_PASSWORD=%s\n' "$redis_health_password"
  printf 'PGBACKREST_CIPHER_PASS=%s\n' "$pgbackrest_cipher_pass"
  printf 'RESTIC_PASSWORD=%s\n' "$restic_password"
} >"$STAGING_DIR/recovery.txt"

install -o "$FILE_OWNER" -g "$APP_USER" -m 0640 "$STAGING_DIR/backend.env" "$backend_env"
install -o "$FILE_OWNER" -g "$MIGRATOR_USER" -m 0640 "$STAGING_DIR/migration.env" "$migration_env"
install -o "$FILE_OWNER" -g "$SECRETS_GROUP" -m 0640 "$STAGING_DIR/compose.env" "$compose_env"
install -o "$FILE_OWNER" -g "$SECRETS_GROUP" -m 0640 "$STAGING_DIR/database-roles.env" "$roles_env"
install -o "$FILE_OWNER" -g "$SECRETS_GROUP" -m 0640 "$STAGING_DIR/pgbackrest.conf" "$pgbackrest_config"
install -o "$FILE_OWNER" -g "$SECRETS_GROUP" -m 0640 "$STAGING_DIR/redis-users.acl" "$redis_acl"
install -o "$FILE_OWNER" -g "$SECRETS_GROUP" -m 0640 "$STAGING_DIR/postgres-owner-password" "$postgres_owner_password_file"
install -o "$FILE_OWNER" -g "$SECRETS_GROUP" -m 0640 "$STAGING_DIR/postgres-backup-password" "$postgres_backup_password_file"
install -o "$FILE_OWNER" -g "$SECRETS_GROUP" -m 0640 "$STAGING_DIR/redis-ops-password" "$redis_ops_password_file"
install -o "$FILE_OWNER" -g "$SECRETS_GROUP" -m 0640 "$STAGING_DIR/redis-health-password" "$redis_health_password_file"
install -o "$FILE_OWNER" -g "$PRIVATE_GROUP" -m 0600 "$STAGING_DIR/restic-password" "$restic_password_file"
install -o "$FILE_OWNER" -g "$PRIVATE_GROUP" -m 0600 "$STAGING_DIR/alerts.env" "$alerts_env"
install -o "$FILE_OWNER" -g "$PRIVATE_GROUP" -m 0600 "$STAGING_DIR/recovery.txt" "$RECOVERY_FILE"
chmod 0600 "$SOURCE_ENV"

echo "内部数据密钥已在 VPS 本地生成（未输出任何口令）。"
echo "离线恢复清单: $RECOVERY_FILE"
echo "激活前必须通过 SSH 抄入密码管理器，并填写 RainS3 与 OPS_ALERT_TO 外部配置。"
