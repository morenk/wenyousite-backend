# 媒体

## 概述
媒体模块处理图片上传全流程：生成 S3 预签名上传 URL 并预建 Media 记录、确认上传完成并触发异步图片处理、查询处理状态。一条 `mediaId` 贯穿全链路。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `Media` | 媒体文件记录，存储 URL、对象存储 key、元信息（尺寸、大小）、处理状态 |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/media/upload-url` | `@Auth()` | 获取 S3 预签名上传 URL（有效期 600s），预建 Media 记录（status=UPLOADING），返回 `mediaId` |
| `POST` | `/media/upload-done` | `@Auth()` | 确认上传完成（传入 mediaId），校验 S3 对象存在 + 归属，转 PROCESSING 并入队 |
| `GET` | `/media/:id` | `@Auth()` | 查询图片处理状态和元信息（UPLOADING / PROCESSING / COMPLETED / FAILED） |

## 响应契约

- `POST /media/upload-url` 的 `data` 为 `UploadUrlResponseDto`：`uploadUrl`、`mediaId`、`objectKey`、`publicUrl`。
- `POST /media/upload-done` 的 `data` 为 `ConfirmUploadResponseDto`：`media` 与 `processing`。
- `GET /media/:id` 的 `data` 为 `MediaResponseDto`，包含状态、URL、尺寸及创建时间。
- Swagger 中以上 DTO 均位于统一成功 envelope 的 `data` 字段，Web/Flutter 必须使用生成类型，不再手写响应结构。

## 核心业务规则

- 文件类型白名单：`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/avif`, `image/svg+xml`
- 单文件大小限制：10MB（预签名 URL 含 Content-Length 签名，S3 侧拒绝对不上长度的请求）
- 预签名 URL 有效期 600 秒，客户端需在此期间完成直传
- 文件名消毒：提取最后一段扩展名，与 `ALLOWED_EXTENSIONS` 白名单比对（`jpg`, `jpeg`, `png`, `gif`, `webp`, `avif`, `svg`），非白名单或超长扩展名统一返回 `bin`
- 对象存储路径格式：`uploads/{YYYY/MM/DD}/{userId}/{timestamp}-{random}.{ext}`
- `upload-url` 阶段预建 Media 记录（`status=UPLOADING`），返回 `mediaId` 贯穿后续操作
- **每用户小时上传配额**：`upload-url` 按用户 + 小时桶 Redis 计数，超过 `UPLOAD_RATE_PER_HOUR`（默认 60 次/小时）返回 429，防止刷爆对象存储
- `upload-done` 以 `mediaId` 为参数，通过 DB 查 user 做归属校验，检查 S3 对象存在性
- `key` 字段唯一约束，防止重复确认同一上传
- SVG 文件跳过图片处理（矢量图无需缩放），直接从 UPLOADING 转 COMPLETED
- 图片处理通过 BullMQ `image` 队列异步执行，重试 2 次，固定退避 10s
- sharp 生成两种派生图：缩略图 `_thumb.webp`（300×300 cover，quality 80）和中图 `_md.webp`（800px 等比 inside，quality 85）
- 衍生图设置 `Cache-Control: public, max-age=31536000, immutable`
- 处理成功后更新 Media 记录写入 `width`、`height`、`size`、`status=COMPLETED`
- 处理失败（末次重试耗尽）标记 `status=FAILED`
- 头像设置通过 `PATCH /users/me/avatar` 使用 `mediaId`，校验 `status=COMPLETED`

## MediaStatus 状态机

```
UPLOADING ──(SVG)──> COMPLETED
    │
    └──(upload-done)──> PROCESSING ──(成功)──> COMPLETED
                                    └─(失败耗尽)──> FAILED
```

## 孤儿图片回收

每天凌晨 4 点由 `CleanupTask.cleanup()` 调用 `MediaService.cleanupOrphanMedia()`，防止对象存储只增不减：

1. **构建存活引用集合**（内存 Set，匹配 `media.url`）：
   - `users.avatar`（非 null）
   - 未删除帖子的 `posts.content`（`deletedAt: null`）中正则提取 `![...](url)`
   - `drafts.content`（避免误删正在编辑的草稿图）
   - 引用集合为空时**跳过本次清理**（安全阀）
2. **候选清理对象**（按 `status + createdAt` 过滤）：
   - `UPLOADING` 创建超 24h（上传从未确认）
   - `FAILED` 创建超 7 天
   - `COMPLETED` 创建超 7 天且 URL 不在引用集合（覆盖删帖/删楼/换头像/编辑移除图片）
3. **删除**：批量 `DeleteObjectsCommand` 删除原图 + `_thumb.webp` + `_md.webp`（SVG 仅自身），原图删除成功的才删 DB 记录，失败保留待下次重试。

> 7 天缓冲避免误杀"刚上传还没发帖"的图片。软删除帖子的楼层内容仍计入引用，图片会多保留一段时间（宁可多留不可误删）。

## 设计决策

- 双阶段上传（预签名 URL → 确认）避免服务端中转大文件，由客户端直传 S3
- **upload-url 预建 Media 记录**：媒体追踪 ID（`mediaId`）从第一刻可用，后续每次操作均以此为标识，消除 API 层面 `objectKey` 和 `mediaId` 的双 ID 混乱
- 异步图片处理将耗时操作从请求链路剥离，避免 HTTP 超时
- 缩略图和中图均使用 WebP 格式，在保持画质的同时显著减小体积
- 衍生图一年强缓存，因为衍生图是原生图幂等派生，key 不变内容不变
- SVG 跳过 sharp 处理，因为矢量图缩放无意义且 sharp 对 SVG 支持有限
