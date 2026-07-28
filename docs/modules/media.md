# 媒体

## 概述
媒体模块处理图片上传全流程：生成 S3 预签名上传 URL、确认上传完成并写入数据库、异步生成缩略图和中图。

## 涉及的模型

| 模型 | 说明 |
|------|------|
| `Media` | 媒体文件记录，存储 URL、对象存储 key、元信息（尺寸、大小） |

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/media/upload-url` | `@AuthRead()` | 获取 S3 预签名上传 URL（有效期 600s） |
| `POST` | `/media/upload-done` | `@AuthRead()` | 确认上传完成，写入 DB 并入队图片处理 |

## 核心业务规则

- 文件类型白名单：`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/avif`, `image/svg+xml`
- 单文件大小限制：10MB
- 预签名 URL 有效期 600 秒，客户端需在此期间完成直传
- 文件名消毒：提取最后一段扩展名，与 `ALLOWED_EXTENSIONS` 白名单比对（`jpg`, `jpeg`, `png`, `gif`, `webp`, `avif`, `svg`），非白名单或超长扩展名统一返回 `bin`
- 仅取最后一段扩展名，忽略路径遍历和双重扩展名攻击（如 `evil.jpg.exe` → `exe` → 拒绝）
- 对象存储路径格式：`uploads/{YYYY/MM/DD}/{userId}/{timestamp}-{random}.{ext}`
- `confirmUpload` 检查 S3 对象是否存在后才写入 Media 记录
- SVG 文件跳过图片处理（矢量图无需缩放）
- 图片处理通过 BullMQ `image` 队列异步执行，重试 2 次，固定退避 10s
- sharp 生成两种派生图：缩略图 `_thumb.webp`（300×300 cover，quality 80）和中图 `_md.webp`（800px 等比 inside，quality 85）
- 处理成功后更新 Media 记录写入 `width`、`height`、`size`

## 设计决策

- 双阶段上传（预签名 URL → 确认）避免服务端中转大文件，由客户端直传 S3，降低服务端带宽压力
- 异步图片处理将耗时操作从请求链路剥离，避免 HTTP 超时
- 缩略图和中图均使用 WebP 格式，在保持画质的同时显著减小体积
- 仅取文件名最后一段作为扩展名，是最小攻击面的消毒策略
- SVG 跳过 sharp 处理，因为矢量图缩放无意义且 sharp 对 SVG 支持有限
