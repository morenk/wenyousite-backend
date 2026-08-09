# 登录终端迁移记录（2026-08-05）

状态：已完成，非现行发布步骤。批次标识：`auth-login-terminal-2026-08-05`。

该批次把 refresh token 调整为 Web/mobile 分平台登录终端：未知平台归为 Web，撤销已过期记录，每个用户/平台只保留最新活跃记录，并从同一 family 的最早创建时间回填 `sessionStartedAt`。新版 access token 增加稳定 `sid`；当时签发的无 sid token 只在剩余 15 分钟内兼容。

## 当时的数据量与锁预检

```sql
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE revoked_at IS NULL) AS active_rows,
  COUNT(*) FILTER (WHERE platform IS NULL OR platform NOT IN ('web', 'mobile')) AS invalid_platform_rows
FROM refresh_tokens;

SELECT user_id, COALESCE(platform, '<null>') AS platform, COUNT(*) AS active_count
FROM refresh_tokens
WHERE revoked_at IS NULL
GROUP BY user_id, platform
HAVING COUNT(*) > 1
ORDER BY active_count DESC;
```

迁移会扫描并锁定命中的 refresh token 行；非并发唯一索引、`SET NOT NULL` 和约束校验可能阻塞登录、刷新与登出。`20260805143000_add_session_started_at` 与 `20260805150000_scope_refresh_token_platform_check` 使用显式事务；更早的去重脚本由可重跑清洗语句组成，但不是整文件原子事务。

## 当时的发布与恢复约束

发布前要求数据库备份、迁移状态检查、质量门禁和认证终端 E2E；迁移期间排空认证写流量，先迁移 Schema 再启动新后端，随后验证 Web/mobile 双端并存、同端替换、刷新、终端列表和远程退出。旧字段和移动端响应体 refresh token 在兼容窗口内保留。

迁移失败时检查 `_prisma_migrations`、约束和重复活跃记录，以前滚修复为主；只有核对数据库实际状态后才能使用 `prisma migrate resolve`。已撤销的过期或同端重复 token 不反向恢复，受影响用户重新登录。

## 验证证据

2026-08-05，`pnpm test:e2e:auth-terminal` 在临时 PostgreSQL Schema 中完成旧数据注入、完整迁移链、约束验证和 Nest/Fastify 双端流程，结束后删除临时 Schema。同期 OpenAPI 验证了登录时间字段必填及移动端 refresh token 条件返回。
