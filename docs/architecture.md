# 后端架构与模块边界

## 公网开发环境运行拓扑

后端仓库的 `docker-compose.yml` 是基础设施唯一且受版本控制的 Compose 事实源，只管理 `wenyousite-postgres` 与 `wenyousite-redis`。Caddy、NestJS production build 与 Next.js standalone 均由宿主机 systemd 管理，分别通过 `wenyousite-backend.service` 和 `wenyousite-frontend.service` 监听 3000 与 `127.0.0.1:3001`。工作区根目录和前端仓库不得再添加重复 Compose，也不得假定存在 `api`、`web`、`caddy` Compose 服务。

PostgreSQL 备份由 `scripts/backup.sh` 生成并验证 gzip，Redis 备份由 `scripts/backup-redis.sh` 触发 `BGSAVE`、运行 `redis-check-rdb` 并保存 SHA-256。Redis 开启 AOF，使用 `appendfsync everysec` 与 `noeviction`；首次从纯 RDB 切换时，部署脚本会在备份后受控重建容器，并用哨兵键验证数据跨重启保留。

当前开发部署助手 `scripts/deploy.sh` 只接受目标分支上工作区干净、已推送且与远端完全一致的提交，按“安全审计与门禁 → 再验证提交 → 检查现有基础设施 → 停止旧进程并确认遗留通知队列为空 → PostgreSQL/Redis 备份 → 应用 Compose 并验证 Redis AOF → 迁移 → 记录 revision → 安装 unit → 重启后端 → 公网烟雾”执行。后端启动器从部署写入的 revision 文件读取 `BUILD_SHA`，服务重启不会把可变工作区 HEAD 误报为已部署版本。

## 总体形态

后端采用 NestJS 模块化单体。部署仍是一个进程，但代码按业务能力分模块，并在模块内区分 HTTP 适配、应用用例、查询、领域策略和基础设施。拆分目标是降低变更耦合，不是引入分布式复杂度。

```text
Controller / Listener
        ↓
Application Service（命令 / 查询 / 策略）
        ↓
Prisma / Redis / BullMQ / Object Storage
```

## 层级规则

1. Controller 只负责路由、认证上下文、DTO 和状态码，不直接注入 `PrismaService`（健康检查除外）。
2. 写用例在应用服务中维护权限校验和事务边界；跨多个写入的不变量必须放进同一个 Prisma 事务。
3. 高复杂模块可按命令/查询/策略拆分，例如 `ThreadsService + ThreadQueryService`、`PostsService + PostQueryService + PostingPolicyService`。
4. `common` 仅容纳响应包装、异常、通用 DTO 和纯函数；带业务语义的访问策略位于 `access`。
5. 队列生产者/消费者归所属业务模块：通知归 `notifications`，图片处理归 `media`；`jobs` 只保留跨模块维护任务。
6. 模块必须显式导入依赖的特性模块，不通过全局 `CommonModule` 隐式获得领域服务。
7. `admin` 只承载管理端认证、Controller 和站务编排；处罚、内容处置、案件与审计属于顶层 `moderation` 能力，`reports` 等业务模块不得反向依赖 `admin` 的治理实现。
8. S3 兼容协议、客户端构造、预签名和公开 URL 统一由 `storage/ObjectStorageService` 适配；媒体、表情等模块只声明各自的对象键与内容策略。

这些规则由 `pnpm arch:check` 自动检查。当前还限制单个 service 不超过 650 行；达到阈值前应优先按职责拆分。

## 可靠事件链路

关键异步副作用使用 Transactional Outbox：

```text
业务请求
  └─ Prisma transaction
       ├─ 写业务状态
       └─ 写 domain_outbox（event_key 唯一）
              ↓ commit
OutboxDispatcher（FOR UPDATE SKIP LOCKED）
  └─ EventEmitter2.emitAsync
       ├─ 通知 / 提及
       └─ Redis 查询投影
              ↓ 全部成功
       processed_at = now()
```

- 分发语义是至少一次；监听器必须幂等。
- `NotificationProducer` 会等待权威通知以稳定 `eventKey` 幂等落入 PostgreSQL；落库失败会让 Outbox 保持未确认并重试，不再依赖 Redis 中的通知中间队列。
- 移动推送仅是通知落库后的尽力提示通道；入队失败不会回滚权威通知，客户端始终以通知 API 和未读数为准。
- 点赞和回复计数不执行重复 `INCR`，而是读取数据库权威计数后覆盖 Redis。
- 事件名与载荷由 `outbox/domain-events.ts` 统一建模并在分发前校验；非法载荷或没有消费者的事件保持未确认。
- 失败事件按退避时间重试；60 秒领取租约允许实例崩溃后重新领取。
- 已处理事件保留 7 天供审计，未处理事件永不由清理任务删除。
- 进程收到 `SIGTERM` / `SIGINT` 后停止领取新 Outbox，等待当前批次结束，再由 NestJS 完成资源关闭。

当前可靠事件包括 `post.created`、`post.mentions.updated`、`thread.published`、`thread.liked`、`thread.unliked`、`user.followed`、`user.level_up`、`moment.comment.created`、`direct-message.created` 与 `tip.completed`。缓存失效等可重建的本地事件仍可直接使用进程内事件。

## API 与类型契约

运行时成功响应统一为 `{ code, message, data, meta? }`，错误响应统一为 `{ code, message, data: null }`。Swagger 构建阶段使用同一 envelope 包装 2xx JSON schema，并为所有操作补充 `ApiErrorEnvelope` 兜底响应；命令型空结果使用 `MessageResponseDto`。

当前契约版本由源码 `API_CONTRACT_VERSION`、`/meta` 和响应头共同暴露，历史变化只记录在 [契约变更记录](../contracts/CHANGELOG.md)。破坏性接口变更必须递增版本并同步受版本控制的 OpenAPI 与客户端生成类型。`BusinessErrorCode` 由后端 `ErrorCode` 自动写入 OpenAPI，客户端不得复制无校验的错误码表。

`pnpm openapi:check` 校验：

- 每个操作都有唯一 `operationId`；
- 每个 2xx JSON 响应引用以 `operationId + 状态码` 命名的具名 envelope schema；
- 分页响应必须引用带 `meta.cursor` / `meta.hasMore` 的分页 envelope；
- Public / OptionalAuth / Bearer / Appeal / Admin 的 `security` 与 `x-auth-mode` 一致；
- 本地 `$ref` 均可解析；
- 查询参数不得生成空 schema，OpenAPI 必须声明生产与本地 server；
- 已提交的 `contracts/openapi.json` 必须与代码实时导出结果逐字节一致；
- 用户端及管理端成功响应都必须使用具名 DTO，不保留匿名响应预算；
- 每个操作的兜底错误以及已声明的 4xx/5xx 响应都必须引用 `ApiErrorEnvelope`。

`pnpm docs:check` 额外校验生成端点表、错误码表、Markdown v3 三份黄金语料和已知历史错误。客户端生成必须消费仓库内已审核的契约产物，不直接抓取某个正在运行的开发实例。

TypeScript 开启 `noImplicitAny` 等严格增量选项。Fastify 的 Passport `request.user` 通过模块声明统一建模，新的控制器优先使用 `@CurrentUser()`。

## 配置

所有环境变量读取集中在 `src/config/configuration.ts`，业务代码通过 `ConfigService` 或该配置工厂获得值。入口、日志、Cookie、Swagger 和 Sentry 不应各自解释环境变量，避免默认值漂移。

Sentry 在应用模块加载前由 `src/instrument.ts` 初始化；没有 `SENTRY_DSN` 时保持关闭，有 DSN 时携带部署 release/build 信息。发送前会移除请求 URL、查询、正文、认证头、Cookie、用户对象、额外上下文和 breadcrumbs，仅保留请求 ID、方法、路由模板及可控机器标签。HTTP 日志同样只记录路由模板和结构化错误字段：5xx 带脱敏堆栈，401/403/429 为 warn，其余 4xx 为 info。
