#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/wenyousite-security-preflight.XXXXXX")
CONFIG_ROOT="$TEST_ROOT/etc/wenyousite"
SECRETS_DIR="$CONFIG_ROOT/secrets"
FAKE_BIN="$TEST_ROOT/bin"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/wenyousite-security-preflight.*) find "$TEST_ROOT" -depth -delete ;;
    *) echo "拒绝清理非测试目录: $TEST_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$SECRETS_DIR" "$FAKE_BIN"

cat >"$FAKE_BIN/restic" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = version ] && { echo 'restic 0.16.4 compiled with go1.test'; exit 0; }
exit 1
SH
cat >"$FAKE_BIN/docker" <<'SH'
#!/usr/bin/env bash
exit 1
SH
cat >"$FAKE_BIN/id" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = -nG ] && [ "${2:-}" = wenyousite-backend ]; then
  echo 'wenyousite-backend wenyousite-runtime'
  exit 0
fi
if [ "${1:-}" = -nG ] && [ "${2:-}" = wenyousite-migrator ]; then
  echo 'wenyousite-migrator wenyousite-runtime'
  exit 0
fi
exec /usr/bin/id "$@"
SH
cat >"$FAKE_BIN/stat" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = -c ] && [ "$#" -eq 3 ]; then
  format=$2
  path=$3
  case "$format" in
    %u) echo 0; exit 0 ;;
    %g) echo 4242; exit 0 ;;
    %G)
      case "$path" in
        */backend.env) echo wenyousite-backend ;;
        */migration.env) echo wenyousite-migrator ;;
        *) echo wenyousite-secrets ;;
      esac
      exit 0
      ;;
    %a)
      case "$path" in
        */secrets) echo 750 ;;
        */restic.env|*/alerts.env|*/restic-password) echo 600 ;;
        *) echo 640 ;;
      esac
      exit 0
      ;;
  esac
fi
exec /usr/bin/stat "$@"
SH
chmod 0755 "$FAKE_BIN/restic" "$FAKE_BIN/docker" "$FAKE_BIN/id" "$FAKE_BIN/stat"

owner_password=$(printf 'a%.0s' {1..64})
app_password=$(printf 'b%.0s' {1..64})
backup_password=$(printf 'c%.0s' {1..64})
monitor_password=$(printf 'd%.0s' {1..64})
redis_app_password=$(printf 'e%.0s' {1..64})
redis_ops_password=$(printf 'f%.0s' {1..64})
redis_health_password=$(printf '1%.0s' {1..64})
redis_app_hash=$(printf '%s' "$redis_app_password" | sha256sum | cut -d' ' -f1)
redis_ops_hash=$(printf '%s' "$redis_ops_password" | sha256sum | cut -d' ' -f1)
redis_health_hash=$(printf '%s' "$redis_health_password" | sha256sum | cut -d' ' -f1)

cat >"$CONFIG_ROOT/compose.env" <<ENV
# Values marked CHANGE_ME are rejected; comments are not configuration values.
WENYOUSITE_SECRETS_DIR=$SECRETS_DIR
WENYOUSITE_SECRETS_GID=4242
POSTGRES_OWNER_USER=wenyousite_owner
POSTGRES_DATABASE=wenyousite
POSTGRES_ARCHIVE_MODE=on
POSTGRES_ARCHIVE_TIMEOUT=300s
POSTGRES_VOLUME=wenyousite_pgdata
REDIS_HEALTH_USERNAME=wenyousite_health
REDIS_OPS_USERNAME=wenyousite_ops
REDIS_VOLUME=wenyousite_redisdata
ENV
cat >"$CONFIG_ROOT/backend.env" <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://wenyousite_app:$app_password@127.0.0.1:5432/wenyousite?schema=public
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
REDIS_USERNAME=wenyousite_app
REDIS_PASSWORD=$redis_app_password
ENV
cat >"$CONFIG_ROOT/migration.env" <<ENV
DATABASE_URL=postgresql://wenyousite_owner:$owner_password@127.0.0.1:5432/wenyousite?schema=public
DIRECT_DATABASE_URL=postgresql://wenyousite_owner:$owner_password@127.0.0.1:5432/wenyousite?schema=public
ENV
cat >"$SECRETS_DIR/database-roles.env" <<ENV
POSTGRES_OWNER_PASSWORD=$owner_password
POSTGRES_APP_PASSWORD=$app_password
POSTGRES_BACKUP_PASSWORD=$backup_password
POSTGRES_MONITOR_PASSWORD=$monitor_password
ENV
printf '%s\n' "$owner_password" >"$SECRETS_DIR/postgres-owner-password"
printf '%s\n' "$backup_password" >"$SECRETS_DIR/postgres-backup-password"
printf '%s\n' "$redis_ops_password" >"$SECRETS_DIR/redis-ops-password"
printf '%s\n' "$redis_health_password" >"$SECRETS_DIR/redis-health-password"
cat >"$SECRETS_DIR/redis-users.acl" <<ACL
user default reset off
user wenyousite_app on #$redis_app_hash ~* &* +@all -acl -bgrewriteaof -bgsave -config -debug -flushall -flushdb -migrate -module -monitor -replicaof -restore -save -shutdown -slaveof
user wenyousite_ops on #$redis_ops_hash ~* &* +@all
user wenyousite_health on #$redis_health_hash ~* &* +ping
ACL
cat >"$SECRETS_DIR/pg_hba.conf" <<'HBA'
local all postgres peer
local all all scram-sha-256
host wenyousite wenyousite_owner,wenyousite_app,wenyousite_backup,wenyousite_monitor 127.0.0.1/32 scram-sha-256
host wenyousite wenyousite_owner,wenyousite_app,wenyousite_backup,wenyousite_monitor ::1/128 scram-sha-256
host wenyousite wenyousite_owner,wenyousite_app,wenyousite_backup,wenyousite_monitor 172.16.0.0/12 scram-sha-256
host all all 0.0.0.0/0 reject
host all all ::/0 reject
HBA
cat >"$SECRETS_DIR/pgbackrest.conf" <<'CONF'
[wenyousite]
pg1-path=/var/lib/postgresql/data
pg1-socket-path=/var/run/postgresql
[global]
repo1-type=s3
repo1-path=/wenyousite/postgresql
repo1-s3-bucket=wenyousite-private-test
repo1-s3-endpoint=cn-nb1.rains3.com
repo1-s3-region=cn-nb1
repo1-s3-uri-style=path
repo1-s3-key=dedicated-test-access-key
repo1-s3-key-secret=dedicated-test-secret-key
repo1-storage-verify-tls=y
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=0123456789abcdef0123456789abcdef
repo1-retention-full-type=time
repo1-retention-full=35
archive-async=n
start-fast=y
process-max=2
compress-type=zst
compress-level=6
log-level-console=info
log-level-file=off
lock-path=/tmp/pgbackrest
CONF
cat >"$CONFIG_ROOT/restic.env" <<'ENV'
RESTIC_REPOSITORY=s3:https://cn-nb1.rains3.com/wenyousite-private-test/wenyousite/restic
AWS_ACCESS_KEY_ID=dedicated-test-access-key
AWS_SECRET_ACCESS_KEY=dedicated-test-secret-key
AWS_DEFAULT_REGION=cn-nb1
RESTIC_PASSWORD_FILE=CONFIG_ROOT_PLACEHOLDER/restic-password
RESTIC_CACHE_DIR=/var/cache/wenyousite/restic
ENV
sed -i "s|CONFIG_ROOT_PLACEHOLDER|$CONFIG_ROOT|" "$CONFIG_ROOT/restic.env"
printf '%s\n' '0123456789abcdef0123456789abcdef' >"$CONFIG_ROOT/restic-password"
cat >"$CONFIG_ROOT/alerts.env" <<'ENV'
OPS_SMTP_HOST=smtp.example.test
OPS_SMTP_PORT=465
OPS_SMTP_SECURE=true
OPS_SMTP_USER=ops@example.test
OPS_SMTP_PASS=test-smtp-password
OPS_SMTP_FROM=ops@example.test
OPS_ALERT_TO=alerts@example.test
ENV

PATH="$FAKE_BIN:$PATH" WENYOUSITE_CONFIG_ROOT="$CONFIG_ROOT" \
  bash "$SCRIPT_DIR/validate-production-security.sh" >/dev/null

cp "$CONFIG_ROOT/compose.env" "$TEST_ROOT/compose.env.valid"
sed -i 's/^WENYOUSITE_SECRETS_GID=4242$/WENYOUSITE_SECRETS_GID=CHANGE_ME_NUMERIC_GID/' \
  "$CONFIG_ROOT/compose.env"
if PATH="$FAKE_BIN:$PATH" WENYOUSITE_CONFIG_ROOT="$CONFIG_ROOT" \
  bash "$SCRIPT_DIR/validate-production-security.sh" >/dev/null 2>&1; then
  echo "门禁错误接受了非注释配置中的占位值" >&2
  exit 1
fi
cp "$TEST_ROOT/compose.env.valid" "$CONFIG_ROOT/compose.env"

cp "$SECRETS_DIR/redis-users.acl" "$TEST_ROOT/redis-users.acl.valid"
sed -i 's/ -config / /' "$SECRETS_DIR/redis-users.acl"
if PATH="$FAKE_BIN:$PATH" WENYOUSITE_CONFIG_ROOT="$CONFIG_ROOT" \
  bash "$SCRIPT_DIR/validate-production-security.sh" >/dev/null 2>&1; then
  echo "门禁错误接受了 Redis app CONFIG 权限" >&2
  exit 1
fi
cp "$TEST_ROOT/redis-users.acl.valid" "$SECRETS_DIR/redis-users.acl"

printf 'DATABASE_URL=postgresql://duplicate:duplicate@127.0.0.1/wenyousite\n' >>"$CONFIG_ROOT/backend.env"
if PATH="$FAKE_BIN:$PATH" WENYOUSITE_CONFIG_ROOT="$CONFIG_ROOT" \
  bash "$SCRIPT_DIR/validate-production-security.sh" >/dev/null 2>&1; then
  echo "门禁错误接受了重复运行凭据" >&2
  exit 1
fi

echo "Production security preflight tests passed"
