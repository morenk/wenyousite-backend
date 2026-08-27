#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-secret-generation.XXXXXX")
CONFIG_ROOT="$TEST_ROOT/etc/wenyousite"
SECRETS_DIR="$CONFIG_ROOT/secrets"
SOURCE_ENV="$TEST_ROOT/source.env"
RECOVERY_FILE="$TEST_ROOT/recovery.txt"
OUTPUT_FILE="$TEST_ROOT/output.txt"
TEST_USER=$(id -un)
TEST_GROUP=$(id -gn)

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/wenyousite-secret-generation.*) find "$TEST_ROOT" -depth -delete ;;
    *) echo "拒绝清理非测试目录: $TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

install -d -m 0755 "$CONFIG_ROOT"
install -d -m 0750 "$SECRETS_DIR"
install -m 0640 "$BACKEND_DIR/ops/secrets/compose.env.example" "$CONFIG_ROOT/compose.env"
install -m 0640 "$BACKEND_DIR/ops/secrets/database-roles.env.example" "$SECRETS_DIR/database-roles.env"
install -m 0640 "$BACKEND_DIR/ops/secrets/pgbackrest.conf.example" "$SECRETS_DIR/pgbackrest.conf"
install -m 0640 "$BACKEND_DIR/ops/secrets/redis-users.acl.example" "$SECRETS_DIR/redis-users.acl"
install -m 0640 "$BACKEND_DIR/ops/secrets/migration.env.example" "$CONFIG_ROOT/migration.env"
install -m 0600 "$BACKEND_DIR/ops/secrets/alerts.env.example" "$CONFIG_ROOT/alerts.env"
for empty_file in backend.env restic-password; do install -m 0600 /dev/null "$CONFIG_ROOT/$empty_file"; done
for empty_file in redis-ops-password redis-health-password postgres-owner-password postgres-backup-password; do
  install -m 0640 /dev/null "$SECRETS_DIR/$empty_file"
done

{
  printf 'DATABASE_URL=postgresql://legacy:legacy@127.0.0.1/wenyousite\n'
  printf 'DIRECT_DATABASE_URL=postgresql://legacy:legacy@127.0.0.1/wenyousite\n'
  printf 'REDIS_HOST=legacy-redis\n'
  printf 'REDIS_PASSWORD=legacy-password\n'
  printf 'JWT_ACCESS_SECRET=test-access-secret\n'
  printf 'SES_SMTP_HOST=smtp.example.test\n'
  printf 'SES_SMTP_PORT=465\n'
  printf 'SES_SMTP_USER=ops@example.test\n'
  printf 'SES_SMTP_PASS=test-smtp-password\n'
  printf 'SES_FROM_ADDRESS=alerts@example.test\n'
} >"$SOURCE_ENV"
chmod 0644 "$SOURCE_ENV"

WENYOUSITE_CONFIG_ROOT="$CONFIG_ROOT" \
WENYOUSITE_SOURCE_ENV="$SOURCE_ENV" \
WENYOUSITE_RECOVERY_FILE="$RECOVERY_FILE" \
WENYOUSITE_APP_USER="$TEST_USER" \
WENYOUSITE_MIGRATOR_USER="$TEST_USER" \
WENYOUSITE_SECRETS_GROUP="$TEST_GROUP" \
WENYOUSITE_FILE_OWNER="$TEST_USER" \
WENYOUSITE_PRIVATE_GROUP="$TEST_GROUP" \
WENYOUSITE_SECRET_GENERATION_TEST_MODE=true \
  bash "$SCRIPT_DIR/generate-data-security-secrets.sh" --apply >"$OUTPUT_FILE"

value() {
  local file=$1 key=$2
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$file"
}
roles_env="$SECRETS_DIR/database-roles.env"
postgres_owner=$(value "$roles_env" POSTGRES_OWNER_PASSWORD)
postgres_app=$(value "$roles_env" POSTGRES_APP_PASSWORD)
postgres_backup=$(value "$roles_env" POSTGRES_BACKUP_PASSWORD)
postgres_monitor=$(value "$roles_env" POSTGRES_MONITOR_PASSWORD)
redis_app=$(value "$RECOVERY_FILE" REDIS_APP_PASSWORD)
redis_ops=$(value "$RECOVERY_FILE" REDIS_OPS_PASSWORD)
redis_health=$(value "$RECOVERY_FILE" REDIS_HEALTH_PASSWORD)
pgbackrest_cipher=$(value "$RECOVERY_FILE" PGBACKREST_CIPHER_PASS)
restic_password=$(value "$RECOVERY_FILE" RESTIC_PASSWORD)
for secret in "$postgres_owner" "$postgres_app" "$postgres_backup" "$postgres_monitor" \
  "$redis_app" "$redis_ops" "$redis_health" "$pgbackrest_cipher" "$restic_password"; do
  [[ "$secret" =~ ^[0-9a-f]{64}$ ]] || { echo "生成口令格式错误" >&2; exit 1; }
  ! grep -Fq "$secret" "$OUTPUT_FILE" || { echo "生成器输出泄露口令" >&2; exit 1; }
done
[ "$(printf '%s\n' "$postgres_owner" "$postgres_app" "$postgres_backup" "$postgres_monitor" \
  "$redis_app" "$redis_ops" "$redis_health" "$pgbackrest_cipher" "$restic_password" | sort -u | wc -l)" -eq 9 ]

[ "$(value "$CONFIG_ROOT/backend.env" JWT_ACCESS_SECRET)" = test-access-secret ]
[ "$(value "$CONFIG_ROOT/backend.env" DATABASE_URL)" = "postgresql://wenyousite_app:$postgres_app@127.0.0.1:5432/wenyousite?schema=public" ]
[ -z "$(value "$CONFIG_ROOT/backend.env" DIRECT_DATABASE_URL)" ]
[ "$(value "$CONFIG_ROOT/backend.env" REDIS_PASSWORD)" = "$redis_app" ]
[ "$(value "$CONFIG_ROOT/migration.env" DIRECT_DATABASE_URL)" = "postgresql://wenyousite_owner:$postgres_owner@127.0.0.1:5432/wenyousite?schema=public" ]
[ "$(<"$SECRETS_DIR/postgres-owner-password")" = "$postgres_owner" ]
[ "$(<"$SECRETS_DIR/postgres-backup-password")" = "$postgres_backup" ]
[ "$(<"$SECRETS_DIR/redis-ops-password")" = "$redis_ops" ]
[ "$(<"$SECRETS_DIR/redis-health-password")" = "$redis_health" ]
[ "$(<"$CONFIG_ROOT/restic-password")" = "$restic_password" ]

redis_app_hash=$(printf '%s' "$redis_app" | sha256sum | cut -d' ' -f1)
redis_ops_hash=$(printf '%s' "$redis_ops" | sha256sum | cut -d' ' -f1)
redis_health_hash=$(printf '%s' "$redis_health" | sha256sum | cut -d' ' -f1)
grep -q "^user wenyousite_app on #$redis_app_hash " "$SECRETS_DIR/redis-users.acl"
grep -q "^user wenyousite_ops on #$redis_ops_hash " "$SECRETS_DIR/redis-users.acl"
grep -q "^user wenyousite_health on #$redis_health_hash " "$SECRETS_DIR/redis-users.acl"
[ "$(value "$CONFIG_ROOT/alerts.env" OPS_SMTP_HOST)" = smtp.example.test ]
[ "$(value "$CONFIG_ROOT/alerts.env" OPS_SMTP_SECURE)" = true ]
[ "$(value "$CONFIG_ROOT/alerts.env" OPS_SMTP_FROM)" = alerts@example.test ]
[ "$(value "$CONFIG_ROOT/alerts.env" OPS_ALERT_TO)" = CHANGE_ME_ALERT_RECIPIENT ]
[ "$(stat -c %a "$SOURCE_ENV")" = 600 ]
[ "$(stat -c %a "$RECOVERY_FILE")" = 600 ]
grep -q '^repo1-s3-bucket=CHANGE_ME_PRIVATE_BUCKET$' "$SECRETS_DIR/pgbackrest.conf"
grep -q "^repo1-cipher-pass=$pgbackrest_cipher$" "$SECRETS_DIR/pgbackrest.conf"

if WENYOUSITE_CONFIG_ROOT="$CONFIG_ROOT" \
  WENYOUSITE_SOURCE_ENV="$SOURCE_ENV" \
  WENYOUSITE_RECOVERY_FILE="$RECOVERY_FILE" \
  WENYOUSITE_APP_USER="$TEST_USER" \
  WENYOUSITE_MIGRATOR_USER="$TEST_USER" \
  WENYOUSITE_SECRETS_GROUP="$TEST_GROUP" \
  WENYOUSITE_FILE_OWNER="$TEST_USER" \
  WENYOUSITE_PRIVATE_GROUP="$TEST_GROUP" \
  WENYOUSITE_SECRET_GENERATION_TEST_MODE=true \
  bash "$SCRIPT_DIR/generate-data-security-secrets.sh" --apply >/dev/null 2>&1; then
  echo "生成器错误覆盖了既有密钥" >&2
  exit 1
fi

echo "Data-security secret generation tests passed"
