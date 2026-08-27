#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"

rendered=$(env -u POSTGRES_ARCHIVE_MODE -u POSTGRES_ARCHIVE_TIMEOUT \
  docker compose -f "$COMPOSE_FILE" config)
for expected in \
  'archive_mode=off' \
  'archive_timeout=300s' \
  'archive-push %p' \
  'pgbackrest.conf' \
  'redis-users.acl' \
  'appendonly' \
  'everysec' \
  'noeviction'; do
  grep -q -- "$expected" <<<"$rendered" || { echo "Compose 缺少数据耐久配置: $expected" >&2; exit 1; }
done
production_rendered=$(POSTGRES_ARCHIVE_MODE=on docker compose -f "$COMPOSE_FILE" config)
grep -q 'archive_mode=on' <<<"$production_rendered" || { echo "Compose 不能启用生产 WAL 归档" >&2; exit 1; }
[ "$(grep -c 'host_ip: 127.0.0.1' <<<"$rendered")" -ge 2 ] || { echo "数据端口未绑定 loopback" >&2; exit 1; }
grep -q '^[[:space:]]*user: postgres$' <<<"$rendered" || { echo "PostgreSQL 未以原生用户保留密钥补充组" >&2; exit 1; }
grep -q '^[[:space:]]*user: redis$' <<<"$rendered" || { echo "Redis 未以原生用户保留密钥补充组" >&2; exit 1; }
! grep -qE 'target: /run/secrets/wenyousite$' <<<"$rendered" || { echo "容器仍挂载整份数据密钥目录" >&2; exit 1; }
for secret_target in pg_hba.conf pgbackrest.conf postgres-owner-password postgres-backup-password redis-users.acl redis-ops-password redis-health-password; do
  grep -q "target: /run/secrets/wenyousite/$secret_target" <<<"$rendered" || { echo "缺少逐文件密钥挂载: $secret_target" >&2; exit 1; }
done
! grep -qE '^[[:space:]]*#' "$BACKEND_DIR/ops/secrets/redis-users.acl.example" "$BACKEND_DIR/ops/development-secrets/redis-users.acl" || { echo "Redis ACL 文件不得包含注释" >&2; exit 1; }
grep -q 'POSTGRES_VOLUME:-wenyousite_pgdata' "$COMPOSE_FILE" || { echo "PostgreSQL 活动卷不可切换" >&2; exit 1; }
grep -q 'REDIS_VOLUME:-wenyousite_redisdata' "$COMPOSE_FILE" || { echo "Redis 活动卷不可切换" >&2; exit 1; }
grep -q 'sha256:742f40ea' "$COMPOSE_FILE" "$BACKEND_DIR/docker/postgres/Dockerfile" || { echo "PostgreSQL 基础镜像未固定摘要" >&2; exit 1; }
grep -q 'sha256:e7723ff7' "$COMPOSE_FILE" || { echo "Redis 镜像未固定摘要" >&2; exit 1; }

for expected in BGSAVE rdb_saves redis-check-rdb sha256sum restic_backup_files; do
  grep -q -- "$expected" "$SCRIPT_DIR/backup-redis.sh" || { echo "Redis 备份缺少: $expected" >&2; exit 1; }
done
for expected in 'format=custom' 'compress=zstd:6' 'pg_restore --list' sha256sum restic_backup_files; do
  grep -q -- "$expected" "$SCRIPT_DIR/backup.sh" || { echo "PostgreSQL 逻辑备份缺少: $expected" >&2; exit 1; }
done
for expected in 'backup --type=' 'pgbackrest' 'record_backup_success'; do
  grep -q -- "$expected" "$SCRIPT_DIR/backup-postgres-physical.sh" || { echo "物理备份缺少: $expected" >&2; exit 1; }
done

backup_line=$(grep -n 'backup-postgres-physical.sh' "$SCRIPT_DIR/deploy.sh" | head -n 1 | cut -d: -f1)
compose_line=$(grep -n 'up -d --build --wait postgres redis' "$SCRIPT_DIR/deploy.sh" | head -n 1 | cut -d: -f1)
migrate_line=$(grep -n 'wenyousite-database-migrate.service' "$SCRIPT_DIR/deploy.sh" | tail -n 1 | cut -d: -f1)
[[ -n "$backup_line" && -n "$compose_line" && -n "$migrate_line" ]] &&
  (( backup_line < compose_line && compose_line < migrate_line )) || {
  echo "部署未保持备份 → 基础设施 → migration 顺序" >&2
  exit 1
}

for script in \
  activate-data-security.sh \
  backup-alert.sh \
  backup-postgres-physical.sh \
  enable-postgres-checksums.sh \
  generate-data-security-secrets.sh \
  harden-database-roles.sh \
  initialize-backup-repositories.sh \
  monitor-backup-health.sh \
  restore-activate.sh \
  restore-discard.sh \
  restore-drill.sh \
  restore-prepare.sh \
  restic-maintenance.sh \
  validate-production-security.sh \
  validate-running-data-security.sh; do
  [ -x "$SCRIPT_DIR/$script" ] || { echo "运维入口不可执行: $script" >&2; exit 1; }
done

grep -q 'ACTIVATE_WENYOUSITE_RESTORE' "$SCRIPT_DIR/restore-activate.sh" || { echo "恢复切换缺少显式确认" >&2; exit 1; }
grep -q 'restore-candidate=true' "$SCRIPT_DIR/restore-prepare.sh" || { echo "恢复卷缺少来源标签" >&2; exit 1; }
grep -q 'pg_amcheck' "$SCRIPT_DIR/restore-prepare.sh" || { echo "PITR 候选缺少离线校验" >&2; exit 1; }
grep -q -- '--install-missing' "$SCRIPT_DIR/restore-prepare.sh" || { echo "PITR 完整性检查未安装缺失的 amcheck 扩展" >&2; exit 1; }
grep -Fq 'pgbackrest_target=$(date -u -d "$target_utc"' "$SCRIPT_DIR/restore-prepare.sh" || { echo "PITR 目标未转换为 pgBackRest 时间格式" >&2; exit 1; }
grep -Fq 'pgbackrest_target_type=name' "$SCRIPT_DIR/restore-prepare.sh" || { echo "PITR 不支持确定性的命名恢复点" >&2; exit 1; }
grep -Fq -- '--type="$pgbackrest_target_type"' "$SCRIPT_DIR/restore-prepare.sh" || { echo "PITR 未使用受控恢复类型" >&2; exit 1; }
grep -Fq -- '--target="$pgbackrest_target"' "$SCRIPT_DIR/restore-prepare.sh" || { echo "PITR 未使用转换后的恢复目标" >&2; exit 1; }
[ "$(grep -c -- '--user postgres' "$SCRIPT_DIR/restore-prepare.sh")" -ge 2 ] || { echo "PITR 校验容器未固定 PostgreSQL 原生用户" >&2; exit 1; }
[ "$(grep -c -- '--user redis' "$SCRIPT_DIR/restore-prepare.sh")" -ge 2 ] || { echo "Redis 校验容器未固定 Redis 原生用户" >&2; exit 1; }
grep -q 'string.sub(k,1,5).*bull:' "$SCRIPT_DIR/restore-prepare.sh" || { echo "Redis 恢复未清除派生键" >&2; exit 1; }
grep -q -- '--appendonly no' "$SCRIPT_DIR/restore-prepare.sh" || { echo "Redis 恢复没有先加载 RDB" >&2; exit 1; }
grep -q 'redis_sentinel' "$SCRIPT_DIR/restore-prepare.sh" || { echo "Redis 恢复未验证 AOF 跨重启" >&2; exit 1; }
grep -q 'redis-check-aof' "$SCRIPT_DIR/restore-prepare.sh" || { echo "Redis 恢复未校验 AOF" >&2; exit 1; }
grep -Fq 'cp -a /data/appendonlydir "$aof_check_dir/appendonlydir"' "$SCRIPT_DIR/restore-prepare.sh" || { echo "Redis AOF 未复制到可写临时层进行离线校验" >&2; exit 1; }
grep -q 'target_nanoseconds' "$SCRIPT_DIR/restore-prepare.sh" || { echo "Redis 快照未按精确时间选择" >&2; exit 1; }
grep -Fq -- '--postgres-target-name "$restore_point"' "$SCRIPT_DIR/restore-drill.sh" || { echo "恢复演练未使用已归档的命名恢复点" >&2; exit 1; }
grep -q 'pgbackrest.conf:/run/secrets/wenyousite/pgbackrest.conf:ro' "$SCRIPT_DIR/restore-prepare.sh" || { echo "PITR 启动缺少 WAL 拉取配置" >&2; exit 1; }
grep -q 'listen_addresses=' "$SCRIPT_DIR/restore-prepare.sh" || { echo "PITR 校验实例未关闭 TCP 监听" >&2; exit 1; }
grep -q 'replace_active_volumes' "$SCRIPT_DIR/restore-activate.sh" || { echo "恢复卷没有单文件原子切换" >&2; exit 1; }
grep -q '\.work_.*candidate_id' "$SCRIPT_DIR/restore-discard.sh" || { echo "候选删除未清理临时 RDB" >&2; exit 1; }
grep -q 'validate_release_tree' "$SCRIPT_DIR/assemble-backend-release.sh" || { echo "不可变 release 缺少所有权/写权限校验" >&2; exit 1; }
grep -q "dist/app.module.js.*dist/media/image-worker.module.js" "$SCRIPT_DIR/assemble-backend-release.sh" || { echo "不可变 release 缺少生产依赖加载校验" >&2; exit 1; }
node -e 'const p=require(process.argv[1]); for (const name of ["zod", "pino-pretty"]) if (!p.dependencies?.[name] || p.devDependencies?.[name]) process.exit(1)' "$BACKEND_DIR/package.json" || { echo "运行时代码依赖未全部声明为生产依赖" >&2; exit 1; }

drill_line=$(grep -n 'bash "$SCRIPT_DIR/restore-drill.sh"' "$SCRIPT_DIR/activate-data-security.sh" | cut -d: -f1)
marker_line=$(grep -n 'activation_marker=' "$SCRIPT_DIR/activate-data-security.sh" | cut -d: -f1)
[[ -n "$drill_line" && -n "$marker_line" ]] && (( drill_line < marker_line )) || {
  echo "完整安全激活标记早于首次恢复演练" >&2
  exit 1
}
! grep -q 'security-activated' "$SCRIPT_DIR/initialize-backup-repositories.sh" || { echo "仓库初始化错误提前宣告完整激活" >&2; exit 1; }

for timer in \
  wenyousite-redis-backup.timer \
  wenyousite-postgres-physical-backup.timer \
  wenyousite-postgres-logical-backup.timer \
  wenyousite-restic-maintenance.timer \
  wenyousite-restore-drill.timer \
  wenyousite-backup-health.timer; do
  [ -f "$BACKEND_DIR/ops/$timer" ] || { echo "缺少定时器: $timer" >&2; exit 1; }
done
grep -q '00/10' "$BACKEND_DIR/ops/wenyousite-redis-backup.timer" || { echo "Redis RPO 定时器未给 15 分钟目标留出余量" >&2; exit 1; }
grep -q 'OnFailure=wenyousite-backup-alert@%n.service' "$BACKEND_DIR/ops/wenyousite-redis-backup.service" || { echo "备份失败未接 SMTP 告警" >&2; exit 1; }

bash -n "$SCRIPT_DIR"/*.sh
docker compose -f "$COMPOSE_FILE" config --quiet
echo "Database and Redis durability tests passed"
