# 媒体

## 概述

媒体模块处理图片上传全流程：生成 S3 预签名上传 URL 并预建 Media 记录、确认上传完成并触发异步图片处理、查询处理状态。一条 `mediaId` 贯穿全链路。

## 涉及的模型

| 模型         | 说明                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| `Media`      | 媒体文件记录，存储正式 URL、临时 key、用途、动画标记、处理状态与无引用时间           |
| `PostMedia`  | 帖子 Markdown 中精确匹配站内 `Media.url` 的有序引用账本                              |
| `DraftMedia` | 草稿 Markdown 中精确匹配站内 `Media.url` 的有序引用账本                              |

## API 端点

| 方法   | 路径                 | 认证      | 说明                                                                                       |
| ------ | -------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `POST` | `/media/upload-url`  | `@Auth()` | 获取临时对象的 S3 预签名 URL（有效期 600s），预建 Media 记录并返回 `mediaId`             |
| `POST` | `/media/upload-done` | `@Auth()` | 确认上传完成（传入 mediaId），校验对象实际元数据 + 归属，幂等转 PROCESSING 并入队          |
| `POST` | `/media/:id/upload-url` | `@Auth()` | 为本人仍为 UPLOADING 的同一记录和对象 key 重新签发 PUT 地址，不重复计入上传配额          |
| `GET`  | `/media/:id`         | `@Auth()` | 查询图片处理状态和元信息（UPLOADING / PROCESSING / COMPLETED / FAILED）                    |

## 响应契约

- `POST /media/upload-url` 的 `data` 为 `UploadUrlResponseDto`：`uploadUrl`、`mediaId`、临时 `objectKey`、处理完成后才可读取的正式 `publicUrl`。
- `POST /media/upload-done` 的 `data` 为 `ConfirmUploadResponseDto`：`media` 与 `processing`。
- `POST /media/:id/upload-url` 复用 `UploadUrlResponseDto`；其中 `mediaId`、临时 `objectKey` 与正式 `publicUrl` 保持不变，仅 `uploadUrl` 更新。
- `GET /media/:id` 的 `data` 为 `MediaResponseDto`，包含状态、正式 URL、用途、动画标记、尺寸及创建时间。
- Swagger 中以上 DTO 均位于统一成功 envelope 的 `data` 字段，Web/Flutter 必须使用生成类型，不再手写响应结构。

## 核心业务规则

- 文件类型白名单：`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/avif`
- 不接受 SVG：未经净化的 SVG 可携带脚本或外部资源，且会绕过 sharp 的位图解码校验；Web/Flutter 统一在选图阶段过滤，服务端作为最终防线拒绝
- 单文件大小限制：10MB（预签名 URL 含 Content-Length 签名，S3 侧拒绝对不上长度的请求）
- 新客户端应先将静态图旋转归正、最长边缩至 2560px、清除元数据并转成质量约 85 的 WebP；GIF 不在客户端转码。服务端仍执行同样的安全归一化，不能信任客户端结果
- 预签名 URL 有效期 600 秒，客户端需在此期间完成直传
- 文件名消毒：提取最后一段扩展名，与 `ALLOWED_EXTENSIONS` 白名单比对（`jpg`, `jpeg`, `png`, `gif`, `webp`, `avif`），非白名单或超长扩展名统一返回 `bin`
- 临时对象路径为 `staging/{YYYY/MM/DD}/{userId}/{timestamp}-{random}.{ext}`，正式对象为 `media/{YYYY/MM/DD}/{userId}/{timestamp}-{random}.webp|gif`；客户端不得拼接或持久化临时 key
- `upload-url` 阶段预建 Media 记录（`status=UPLOADING`），同时固化客户端声明的 `contentType`、`size` 与可选 `purpose`；旧客户端省略用途时为 `LEGACY`
- **每用户小时上传配额**：`upload-url` 按用户 + 小时桶 Redis 计数，超过 `UPLOAD_RATE_PER_HOUR`（默认 60 次/小时）返回 429，防止刷爆对象存储
- `upload-done` 以 `mediaId` 为参数，通过 DB 查 user 做归属校验，并用 `HeadObject` 核对对象实际 `Content-Length`、`Content-Type`：类型必须仍在白名单内，大小不得超过 10MB；新记录还必须与签发凭证时固化的声明值完全一致
- 元数据缺失或不匹配时将记录转为 `FAILED`，不进入处理队列
- `key` 字段唯一约束，防止重复确认同一上传
- `upload-done` 可安全重试：`PROCESSING` / `COMPLETED` 直接返回当前结果，不重复入队；其他终态拒绝确认
- `upload-done` 的 `HeadObject` 未发现对象时返回 HTTP 404 / `MEDIA_OBJECT_MISSING`；客户端应调用同 ID 重签端点、重新 PUT，再次确认
- 普通图片先以条件更新原子迁移 `UPLOADING → PROCESSING`，再用 `mediaId` 作为 BullMQ `jobId` 入队，避免并发确认生成重复任务；入队失败时条件回滚为 `UPLOADING` 以允许重试
- 图片处理通过独立 systemd 图片 Worker 消费 BullMQ `image` 队列，队列并发为 2、全进程 sharp 并发为 1；重试 2 次，固定退避 10s，避免图片 CPU/内存尖峰拖慢 HTTP
- 静态图校正 EXIF 方向，限制 6400 万输入像素与 2560px 最长边，清除元数据并编码为 WebP 正式主图；服务端不长期保存静态原件
- GIF 原样写入正式对象以保留动画，但限制最长边 2560px、300 帧、60 秒和 1 亿累计像素；非 GIF 的多帧输入拒绝处理
- 用途决定最小派生集：头像、主页背景和表情来源不生成通用派生图；私聊/评论生成缩略图与中图；动态/正文/LEGACY 生成缩略图、信息流与中图；动画 GIF 只按需生成静态缩略图
- 衍生图设置 `Cache-Control: public, max-age=31536000, immutable`
- 处理成功后仅以条件更新把仍为 `PROCESSING` 的 Media 写入 `width`、`height`、`size`、`status=COMPLETED`
- 完成或最终失败后立即删除临时对象；删除偶发失败时保留 `stagingKey`，每日任务继续补偿，不影响已经完成的正式媒体
- 处理失败（末次重试耗尽）仅把仍为 `PROCESSING` 的记录标记 `FAILED`；迟到任务不能覆盖已经完成或已被其他流程迁移的状态
- 进入 `PROCESSING` 时同步记录 `processingStartedAt`。恢复器在应用启动时及每 10 分钟扫描最多 100 条超过 15 分钟未推进的记录：活动队列任务保持不动，失败任务收敛为 `FAILED`，任务缺失或已完成但数据库未完成时按 `mediaId` 重新入队
- 头像设置通过 `PATCH /users/me/avatar` 使用 `mediaId`，校验 `status=COMPLETED`
- 个人主页背景图通过 `PATCH /users/me/profile-cover` 同时绑定 Web `mediaId` 与可选 `mobileMediaId`，额外校验本人归属、jpg/png/webp，以及 3:1 / 2:1 宽高比；客户端从同一原图分别裁剪成品后上传

## MediaStatus 状态机

```
UPLOADING ──(元数据不合法)──────────────────────> FAILED
    │
    └──(upload-done 原子确认)──> PROCESSING ──(成功)──> COMPLETED
              │                            └─(失败耗尽)──> FAILED
              └──(任务丢失对账)──> 按稳定 jobId 重新入队
```

## 孤儿图片回收

每天凌晨 4 点由 `CleanupTask.cleanup()` 调用 `MediaService.cleanupOrphanMedia()`，防止对象存储只增不减：

1. **对账结构化引用**：头像使用 `users.avatar_media_id`；帖子和草稿使用 `post_media` / `draft_media`；主页背景、私聊、动态、动态评论和处理中表情导入沿用既有外键。每日任务先按这些关系修复 `Media.orphanedAt`，不再运行时扫描全表 URL 字符串。
2. **候选清理对象**：
   - `UPLOADING` 创建超 24h（上传从未确认，同时删除临时对象）
   - `FAILED` 创建超 7 天
   - `MEDIA_COMPLETED_ORPHAN_CLEANUP_ENABLED=true` 时，额外纳入 `COMPLETED` 且 `orphanedAt` 超 7 天的记录；默认关闭，待迁移回填审计完成后再开启
3. **最终核验与删除**：删除对象前按权威关系再次过滤仍被引用的媒体；有限并发删除正式主图、仍残留的临时对象及该用途可能存在的派生图。正式主图删除失败时保留 DB 记录待重试，DB 删除前再核验一次引用。

迁移后先运行 `pnpm media:references:audit` 查看可解析引用和未匹配站内 URL；确认后运行 `pnpm media:references:backfill` 写入账本并重建孤儿标记。已完成媒体清理开关保持关闭至少一个 7 天宽限期，复核日志与对象存储备份后再开启。

## 设计决策

- 双阶段上传（预签名 URL → 确认）避免服务端中转大文件，由客户端直传 S3
- **upload-url 预建 Media 记录**：媒体追踪 ID（`mediaId`）从第一刻可用；`objectKey` 只是当前 PUT 的临时地址，业务层不得依赖
- 异步图片处理将耗时操作从请求链路剥离，避免 HTTP 超时
- 静态正式主图和派生图均使用 WebP 并一年强缓存；key 不变时内容不可变
- `purpose` 保持在媒体模块而不进入 Foundation：它是上传与存储策略的 API 枚举，不是跨端 UI/领域模型；Foundation 无需为本次变更发布版本
- 不让不可信 SVG 进入公开原图链路；如未来恢复 SVG，必须先增加服务端净化或安全栅格化步骤
