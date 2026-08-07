# 后端架构与模块边界

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
- 通知以稳定 `eventKey` 落库，重试不会生成重复通知。
- 点赞和回复计数不执行重复 `INCR`，而是读取数据库权威计数后覆盖 Redis。
- 失败事件按退避时间重试；60 秒领取租约允许实例崩溃后重新领取。
- 已处理事件保留 7 天供审计，未处理事件永不由清理任务删除。

当前可靠事件包括 `post.created`、`thread.published`、`thread.liked`、`thread.unliked`、`user.followed`。缓存失效等可重建的本地事件仍可直接使用进程内事件。

## API 与类型契约

运行时成功响应统一为 `{ code, message, data, meta? }`，错误响应统一为 `{ code, message, data: null }`。Swagger 构建阶段使用同一 envelope 包装 2xx JSON schema，并为所有操作补充 `ApiErrorEnvelope` 兜底响应；命令型空结果使用 `MessageResponseDto`。

当前开发契约版本为 `2.1.0-dev.20260806`。2.1 新增一对一私聊模型与端点。破坏性接口变更必须递增 `API_CONTRACT_VERSION`，重新导出 OpenAPI，并同步生成 Web/Flutter 客户端。`BusinessErrorCode` 由后端 `ErrorCode` 自动写入 OpenAPI，客户端不得复制一份无校验的错误码表。

`pnpm openapi:check` 校验：

- 每个操作都有唯一 `operationId`；
- 2xx JSON 响应与运行时 envelope 一致；
- 本地 `$ref` 均可解析；
- 用户端成功响应必须使用具名 DTO；当前仅允许已搁置的 Reports/Admin 8 个操作保留匿名响应债务；
- 每个操作的兜底错误以及已声明的 4xx/5xx 响应都必须引用 `ApiErrorEnvelope`。

TypeScript 开启 `noImplicitAny` 等严格增量选项。Fastify 的 Passport `request.user` 通过模块声明统一建模，新的控制器优先使用 `@CurrentUser()`。

## 配置

所有环境变量读取集中在 `src/config/configuration.ts`，业务代码通过 `ConfigService` 或该配置工厂获得值。入口、日志、Cookie、Swagger 和 Sentry 不应各自解释环境变量，避免默认值漂移。
