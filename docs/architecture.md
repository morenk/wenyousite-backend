# 后端架构与模块边界

## 公网开发环境运行拓扑

后端仓库的 `docker-compose.yml` 是基础设施唯一且受版本控制的 Compose 事实源，只管理 `wenyousite-postgres` 与 `wenyousite-redis`。Caddy、不可变 NestJS release 与 Next.js standalone 均由宿主机 systemd 管理；后端和图片 Worker 使用专用 `wenyousite-backend` 用户，从 `/var/lib/wenyousite/backend/releases/<sha>` 运行，分别监听回环 3000 或只消费队列。工作区根目录和前端仓库不得再添加重复 Compose，也不得假定存在 `api`、`web`、`caddy` Compose 服务。

PostgreSQL 使用 pgBackRest 将连续 WAL 和周 full/日 differential 加密写入私有 S3 仓库，并保留每日 custom-format 逻辑出口；Redis 使用 AOF `everysec` 与每 10 分钟校验 RDB 的 restic 加密副本。异地历史保留 35 天，五分钟巡检同时验证备份时间戳、WAL、data checksums、pgBackRest 和 AOF，失败通过限频 SMTP 告警。恢复只写新卷，离线运行 `pg_amcheck`/RDB 校验后才能显式切换；完整规则见 [数据库安全、备份与恢复](database-operations.md)。

当前开发部署助手 `scripts/deploy.sh` 只接受目标分支上工作区干净、已推送且与远端完全一致的提交，按“安全审计与门禁 → 再验证提交 → 物理/逻辑/Redis 异地备份 → 固定镜像与运行安全验证 → 组装不可变 release → owner migration → 非 root Worker/API → 公网烟雾”执行。启动器从当前不可变 release 的 `BUILD_SHA` 读取版本，服务重启不会把可变工作区 HEAD 误报为已部署版本。

## 总体形态

后端采用 NestJS 模块化单体，公网部署包含 HTTP/定时任务主进程和一个只消费 `image` 队列的图片 Worker。两者使用同一构建与配置，图片 Worker 固定队列并发 2、sharp 并发 1，使图片解码和转码的 CPU/内存压力不再阻塞 HTTP 事件循环；这仍是进程隔离的模块化单体，不引入独立网络服务。

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
8. 图片 S3 兼容协议、客户端构造、预签名和公开 URL 统一由 `storage/ObjectStorageService` 适配；媒体、表情等模块只声明各自的对象键与内容策略。

图片元数据只能由 `common/image-inspection.ts` 读取；该技术层固定首帧读取，向领域层提供 `frameWidth`、`frameHeight`、`frameCount`、`totalFramePixels` 和时长，不暴露 sharp 在全帧模式下表示垂直堆叠尺寸的 `height`。输入及转码输出共用此入口；APNG 的动画声明按 PNG chunk 边界和校验检查；当前明确不支持 APNG，即使只声明一帧也拒绝，防止把独立默认图当成动画内容。未来解码库支持 APNG 时仍须独立评审政策和回归，不随库能力变化自动接受。`media-image-inspection.ts` 保留媒体自身的格式、MIME 与 GIF 预算，表情模块保留独立的静态/动画像素、帧数、时长及转码政策，不共用产品预算。真实编码的多帧、边界、输出尺寸和损坏文件回归验证这项约束。

Android APK 下载使用独立进程、只读缓存和持久化预算账本；仅私有发布 CLI 的 `StreamingApkOrigin` 从专用配置读取存储凭据并流式读取 APK，不复用图片 Buffer 适配器。允许复用已有凭据，代码只调用固定 APK 路径的读取操作，不代表凭据在云端只读或仅限 APK。隔离边界见 [下载网关](app-download-gateway.md)。

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
  └─ 已注册领域 listeners（Promise.allSettled）
       ├─ 通知 / 提及
       └─ Redis 查询投影
              ↓ 全部成功
       processed_at = now()
```

- 分发语义是至少一次；可靠事件监听器显式设置 `suppressErrors: false`，并等待必要副作用完成；异常必须传回分发器，重试依靠业务幂等键去重。
- `NotificationProducer` 会等待权威通知以稳定 `eventKey` 幂等落入 PostgreSQL；落库失败会让 Outbox 保持未确认并重试，不再依赖 Redis 中的通知中间队列。
- 移动推送仅是通知落库后的尽力提示通道；入队失败不会回滚权威通知，客户端始终以通知 API 和未读数为准。
- 点赞和回复计数不执行重复 `INCR`，而是读取数据库权威计数后覆盖 Redis。
- 事件名与载荷由 `outbox/domain-events.ts` 统一建模并在分发前校验；非法载荷或没有消费者的事件保持未确认。
- 每轮最多依次投递 50 条事件，每次只领取下一条，避免后面的事件在等待前一条时耗尽租约。失败按退避时间重试；60 秒领取租约允许实例崩溃后重新领取。确认与失败回写同时匹配 `id / processedAt=null / attempts`，旧领取不能改写后续尝试。
- 已处理事件保留 7 天供审计，未处理事件永不由清理任务删除。
- 进程收到 `SIGTERM` / `SIGINT` 后，Outbox 在 `beforeApplicationShutdown` 停止领取并等待当前投递结束；Prisma 和普通 Redis 在 `onApplicationShutdown` 才断开。Keyv/Bull 使用自己的模块关闭钩子，可能更早关闭；此时缓存尽力失败、入队拒绝，权威通知仍依赖可用的 PostgreSQL 完成。

当前可靠事件包括 `post.created`、`post.mentions.updated`、`thread.published`、`thread.liked`、`thread.unliked`、`thread.collaborator-role.changed`、`user.followed`、`user.level_up`、`moment.created`、`moment.comment.created`、`direct-message.created` 与 `tip.completed`。缓存失效等可重建的本地事件仍可直接使用进程内事件。

互动/拉黑共用用户 `FOR NO KEY UPDATE` 锁，保持相互排斥、用户删除和关键字段更新的等待，但允许通知等外键的 `KEY SHARE`，避免通知与发帖的用户锁环。禁止因需要互斥就无条件升级到 `FOR UPDATE`；涉及用户主键变更时需单独评估锁顺序。

管理写入统一在有序用户/互动锁之后调用 `ThreadAccessService.lockManagement`，获取主题行锁并在同一事务重新验证当前可访问性和成员角色。成员任免也遵循“用户 → 主题 → 成员”顺序；子贴、正文、标签、置顶和聚合编辑不得复用事务外角色作为最终写入授权。只读导出继续使用无写锁的访问校验。

正文表情的 `lastUsedAt` 与内容、媒体引用及 Outbox 同一事务提交，属于原子写入，不是提交后的必达补偿。数据库故障时整笔回滚；幂等创建在成功后重放不会再次写使用时间。草稿不记录使用，发布入口对本次发布的有效正文统一记录到发布者收藏夹。

Outbox 的 `lastError` 仅保存固定阶段、受控错误类别和有限错误码，不持久化异常正文、堆栈、cause 或聚合子错误。初始化、定时领取/投递和停机等待使用同一脱敏诊断；定时包装截断原始异常，避免 Nest 调度器再次打印。

## Redis 故障边界

Redis 使用三套独立客户端：普通 `REDIS_CLIENT` 服务 HTTP 限流与 RedisService，Keyv/node-redis 服务可重建缓存，BullMQ 服务任务生产和持久消费。连接参数仍统一来自 `redisConnectionOptions`，键名、namespace 与 DB 编号不变。

普通命令与缓存命令的底层等待预算为 1000ms，禁用离线排队；普通 ioredis 还禁用未完成命令自动重发，并将请求重试次数设为 0。连接可以后台恢复，但故障期间的旧写入不会在恢复后自动执行。敏感 HTTP 限流错误继续走既有错误 envelope 并拒绝进入处理器；缓存 get 返回 miss，写入/删除失败按尽力策略处理，只记录固定失败类别。缓存批量删除等待全部已启动删除结束；最终关闭后禁止再次连接。这个预算针对单次命令，不是包含多次顺序命令、数据库或外部服务调用的整个 HTTP SLA。

命令超时不证明 Redis 未执行该命令：响应丢失时写入结果未知，调用者必须依赖幂等任务 ID、数据库权威状态或显式补偿，不能盲目重放计数增量。Outbox 的计数投影采用权威值覆盖，通知仍由 PostgreSQL 的稳定 `eventKey` 去重。

BullMQ 生产者在初始化或离线时立即拒绝业务调用，就绪后应用同一命令预算。初始化失败只回收和重建连接、执行 INFO/version 检查及幂等元数据，不重发 add 等业务操作；Scripts 每次取当前连接，避免锁定版本的构造期 Promise 快照永久缓存失败。已取得的 Job 对象不跨连接重建复用，恢复轮次重新 getJob。消费者的主连接与阻塞副本保留持续重连，不给 BZPOPMIN 施加生产者的一秒预算。

Worker 关闭先停止领取任务，在关闭期间对实际非阻塞主连接串行执行有界只读 PING，覆盖等待处理器时才发生的断连。仅主连接未就绪或探测失败时先关闭 BullMQ 主连接状态以停止无效 ACK 重试，再断开本 Worker 登记的连接及阻塞副本，随后仍等待 BullMQ 标准 close 和活动处理器；健康慢处理器仍完成并确认任务。任意图片处理器或外部依赖自行挂起不在本次有界保证内，Redis 故障时尚未确认的任务由后续正常 stalled/retry 机制处理。

Outbox 对当前已注册领域 listeners 等待全部 settled 后才重试，避免单个快速失败导致同一次投递的其它副作用仍在运行时开始重投。当前 EventEmitterModule 未使用 wildcard/onAny，这不是对任意 EventEmitter2 扩展语义的替代。此处不使用放弃原操作的外层超时；数据库、外部依赖或多次操作仍可能超过 60 秒租约，attempt 条件仅保护领取状态回写，不能消除所有跨实例迟到副作用，因此监听器的幂等约束仍然必要。

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

`pnpm docs:check` 额外校验生成端点表、错误码表、Markdown v4/v5 的正文、节点、编辑器往返、图片块对齐和剪贴板黄金语料，以及已知历史错误。客户端生成必须消费仓库内已审核的契约产物，不直接抓取某个正在运行的开发实例。

TypeScript 开启 `noImplicitAny` 等严格增量选项。Fastify 的 Passport `request.user` 通过模块声明统一建模，新的控制器优先使用 `@CurrentUser()`。

## 配置

所有环境变量读取集中在 `src/config/configuration.ts`，业务代码通过 `ConfigService` 或该配置工厂获得值。入口、日志、Cookie、Swagger 和 Sentry 不应各自解释环境变量，避免默认值漂移。

Sentry 在应用模块加载前由 `src/instrument.ts` 初始化；没有 `SENTRY_DSN` 时保持关闭，有 DSN 时携带部署 release/build 信息。发送前会移除请求 URL、查询、正文、认证头、Cookie、用户对象、额外上下文和 breadcrumbs，仅保留请求 ID、方法、路由模板及可控机器标签。HTTP 日志同样只记录路由模板和结构化错误字段：5xx 带脱敏堆栈，401/403/429 为 warn，其余 4xx 为 info。

## 邮件传输

`EmailService` 保持生产直接 TLS SMTP 与测试 JSON transport 分离。依赖升级的 Node / 模块 / 类型兼容、证书主机名验证及本地邮件安全回归见[邮件依赖与安全回归](email-security.md)。

## 列表动画预览隔离

可选 GIF 预览复用独立图片 Worker / BullMQ，通过可杀死的 Node 子进程运行现有 Sharp/libvips，不在 HTTP 进程解码全帧。单 Worker 同时只执行一个预览子进程；槽等待、两档编码、补偿建账、对象上传和可选发布事务共用截止时间。新 GIF 的完整 WebP 展示已成功发布后，才进入附加预览优化；预览失败不影响完整展示的完成条件。资源上限、CAS 发布、独立尝试 key、迟到上传补偿及测量证据见[列表动画预览](media-animation-previews.md)。

完整 GIF 展示、表情与列表档位共用保帧容器编码，完整展示是必需产物，不能用可选预览替代。来源身份、响应投影授权、独立补处理和资源预算见[完整动画 WebP 展示契约](media-display.md)。
