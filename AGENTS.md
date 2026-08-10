# 温油站后端 — Codex 工作约定

## 1. 项目与事实源

- 本仓库提供温油站 NestJS API；主要技术为 TypeScript、NestJS、Prisma、PostgreSQL、Redis、BullMQ、Jest。
- 公网运行拓扑以工作区 [README](../README.md) 为唯一事实源；命令以 `package.json`，数据模型以 `prisma/schema.prisma`，接口以生成的 OpenAPI 为准。
- 修改前先读受影响模块、测试及 [架构文档](docs/architecture.md)。已有设计细节放在 `docs/`，不要复制进本文件。
- Web 与 Flutter 都消费该 API；可观察契约变化必须同时考虑两个客户端。

## 2. 不可破坏的架构约束

### 认证与权限

四类 Guard 语义不得混用：

| 装饰器 | 语义 |
| --- | --- |
| `@Public()` | 完全公开，不解析用户身份 |
| `@OptionalAuth()` | 匿名可访问；有合法凭证时注入身份 |
| `@AuthRead()` | 必须登录，读取权限 |
| `@Auth()` | 必须登录，写入或敏感操作权限 |

- Controller 只负责传输层解析、DTO 校验和响应，不直接使用 Prisma、不承载领域规则。
- Service 承担领域策略；对象可见性、封禁、私密内容和资源所有权复用集中式访问策略，不在各模块复制判断。
- 对安全敏感的资源查找应默认加入 `deletedAt: null` 等有效性条件；软删除记录不能因遗漏过滤而重新暴露。
- 权限必须由服务端校验。不能依赖前端隐藏按钮，也不能仅验证“已登录”而忽略资源归属或操作级权限。
- 凭证、密码、Cookie、签名 URL、私密正文和个人信息不得进入日志、异常消息、快照或提交记录。

### 数据一致性与异步任务

- 多表写入、计数与状态联动应使用 Prisma 事务；事务外不要留下可观察的半完成状态。
- 领域写入与异步副作用使用现有 Outbox/队列模式；消费者必须可重试且幂等，不能把“任务只执行一次”当作保证。
- 缓存是派生状态，不得成为权限或持久事实的唯一来源；写入后按现有策略更新或失效。
- 使用现有错误类型和异常映射，避免把数据库细节或内部堆栈暴露给客户端。
- 只为不明显的业务约束、并发假设和安全决策写注释；不要用注释复述代码。

### API 契约

- DTO、Swagger 装饰器与实际响应必须一致；OpenAPI 是 Web/Flutter 共享 HTTP API 的机器事实源。Markdown 与移动推送分别使用 `contracts/` 下的 schema/fixtures，不能从 OpenAPI 推断其正文协议。
- 新增或变更可观察接口时，同步更新 DTO、Swagger、测试、`docs/api-contract.md`、已提交 OpenAPI，以及需要的客户端说明。
- 破坏性变化优先通过兼容字段或新端点演进；确需破坏兼容时，更新 API 版本与变更记录，并明确客户端迁移顺序。
- 不要手改生成产物来伪造契约通过；从源 DTO/Swagger 修正后重新生成。

### 数据库迁移

- Schema 变化必须提交 Prisma migration，禁止只修改 `schema.prisma` 后依赖本地 `db push`。
- 迁移应能作用于现有开发数据。当前没有真实用户，不要求正式生产发布仪式，但也不默认开发数据可随意清空。
- 删除表/列、重建数据或不可逆转换前，必须明确目标和影响；优先采用分阶段兼容迁移。完整部署脚本会先备份数据库。
- 迁移后验证 Prisma Client、相关读写路径和 OpenAPI；需要回填时使用可审计、可重跑的脚本。

## 3. 测试与质量门禁

按变更风险选择验证：

- 纯业务规则、DTO、策略：单元测试。
- Prisma 查询、事务、缓存、Outbox、队列：对应集成测试，并覆盖失败/重试路径。
- Controller、Guard、认证、权限和契约：接口或 E2E 测试，至少覆盖拒绝路径。
- Migration：在可恢复的开发数据库或临时数据库验证应用结果和关键查询。
- Bug 修复必须增加回归测试；若只能依赖外部服务验证，在交付说明中写清原因与证据。

实现过程中先跑受影响测试；代码任务交付前运行：

```bash
pnpm check
```

`pnpm check` 的真实内容以 `package.json` 为准；不要在本文维护容易漂移的 lint 警告数字或完整子命令清单。认证/权限、关键写入或跨端核心旅程再运行：

```bash
pnpm check:full
```

- 完整 API E2E 只允许连接 loopback 服务和可恢复测试数据。
- 公网开发环境可用**专用测试账号做定向写入烟雾**：测试数据需可识别、范围最小、验证后清理；禁止批量删除、清库或不可逆操作。
- 纯文档变更只做链接、格式和差异检查，不运行 `pnpm check`、不构建、不迁移、不重启。
- 不通过跳过测试、放宽断言或扩大警告基线来掩盖失败；修复根因或明确汇报阻塞。

常用命令只保留入口：

```bash
pnpm test
pnpm check
pnpm check:full
pnpm contract:generate
pnpm docs:check
```

## 4. 公网开发环境交付

`wenyou.site` 当前是**单一公网开发环境**，没有真实用户。后端由宿主机 `wenyousite-backend.service` 托管 production build 并监听 `3000`，仅代表稳定运行方式，不等同于正式生产发布，不需要维护窗口或发布审批。

代码任务的默认完成链路：

1. 实现并运行相关测试。
2. 运行 `pnpm check`；高风险任务补充 `pnpm check:full` 或等价验证。
3. 有 migration 时先备份并执行 `prisma migrate deploy`。
4. 自动重启受影响服务，不另行等待部署授权。
5. 检查本机/公网健康、受影响接口或旅程和最近日志。
6. 汇报变更与验证结果。

除非用户明确要求，**不要创建 Git commit，也不要 push**。若明确要求提交，使用 `feat|fix|refactor|test|docs|chore(scope): 中文说明`，且只包含本任务相关文件。

### 后端切换规则

- 纯后端变化只切换 3000；契约同时变化时先切换并验证后端，再同步现有 Web 契约。Flutter 仓库建立前只维护待接入规范，不声称客户端门禁已经执行。
- `pnpm check` 已完成构建；源码未再变化时不要重复 build。
- 依赖或 Prisma 生成器变化时先执行 `pnpm install`/`pnpm prisma:generate` 等对应步骤，以 `package.json` 为准。
- 数据库与 Redis 由后端仓库唯一的 Compose 管理；不要在工作区创建第二套基础设施。

检查完成后的后端切换：

```bash
cd /root/wenyousite/wenyousite-backend
npx prisma migrate deploy
systemctl restart wenyousite-backend.service
```

切换后至少验证：

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/health >/dev/null
curl --fail --silent --show-error https://wenyou.site/api/v1/health >/dev/null
journalctl -u wenyousite-backend.service --no-pager -n 100
```

再验证本次实际受影响接口。启动失败、持续 5xx、迁移失败或关键路径失败时，停止扩大变更并优先前滚修复。

跨前后端、基础设施、备份和迁移的完整批次使用：

```bash
bash scripts/deploy.sh
```

## 5. 参考文档

- [工作区运行拓扑](../README.md)
- [后端架构](docs/architecture.md)
- [API 契约规范](docs/api-contract.md)
- [前端接入指南](docs/frontend-guide.md)
- [Flutter / 原生移动端接入](docs/mobile-client-guide.md)
- [Flutter 设计基础边界](docs/mobile-ui-contract.md)
- [数据模型](docs/data-model.md)
- [部署脚本](scripts/deploy.sh)

详细设计、枚举和模块行为放在对应代码与文档中；本文件只维护跨任务都必须遵守的约束。
