# 图片上传管线

## 架构决策

温油站采用 **预签名直传**（Pre-signed Upload）模型，服务端只负责签发凭证和后续处理，原始文件字节流不经过服务端。

```
┌──────────┐  ① POST /media/upload-url   ┌──────────┐
│          │ ── filename/contentType/size │          │
│  客户端   │ <─ {uploadUrl, mediaId, url} │  NestJS   │
│          │                              │  服务端   │
│          │  ② PUT uploadUrl (binary)    │          │
│          │ ─────── 直传 S3 ──────────> │          │
│          │                              │          │
│          │  ③ POST /media/upload-done  │          │
│          │ ───── { mediaId } ──────────>│          │
│          │                              │     │
│          │  ④ GET /media/:id (轮询)     │     │ ⑤ BullMQ image 队列
│          │ <── { status, width, ... }   │     ▼
└──────────┘                              │ ImageProcessor
                                          │     │
                                          │     │ ⑥ sharp 加工
                                          │     ▼
                                          │   写回 S3
                                          └──────────┘
```

**优势**：
- 从 `upload-url` 返回开始，`mediaId` 贯穿全链路，不再需要客户端在 `objectKey` 和 `mediaId` 之间跳转
- Media 记录在 `upload-url` 阶段预建（`UPLOADING`），完整生命周期可追踪
- 服务端零 IO 压力，大文件上传不占用应用进程内存

---

## Step 1: 获取上传凭证

**端点**：`POST /media/upload-url`（需 `@Auth()` 登录 + 邮箱验证）

**请求 DTO**：

| 字段 | 类型 | 校验规则 | 说明 |
|------|------|----------|------|
| `filename` | `string` | `@MinLength(1) @MaxLength(255)` | 原始文件名，仅用于提取扩展名 |
| `contentType` | `string` | `@IsIn(ALLOWED_MIME)` | MIME 白名单校验 |
| `size` | `number` | `@Min(1) @Max(10485760)` | 文件大小（字节），上限 10MB |

**MIME 白名单**：

| MIME Type | 扩展名 | 支持处理 |
|-----------|--------|----------|
| `image/jpeg` | jpg / jpeg | sharp 缩略图 + 中图 |
| `image/png` | png | sharp 缩略图 + 中图 |
| `image/gif` | gif | sharp 缩略图 + 中图 |
| `image/webp` | webp | sharp 缩略图 + 中图 |
| `image/avif` | avif | sharp 缩略图 + 中图 |
| `image/svg+xml` | svg | **跳过** sharp 处理 |

**文件名消毒**：
- 只取最后一段作为扩展名：`foo.bar.jpg` → `jpg`
- 剔除所有非字母数字字符：`image (1).jpg` → `jpg`
- 非白名单扩展名 / 空扩展名 / 超长扩展名 → fallback 为 `bin`
- 以上规则有效防御**双重扩展名攻击**（如 `photo.jpg.exe`）

**对象键生成规则**：
```
uploads/YYYY/MM/DD/{userId}/{timestamp}-{randomId}.{ext}
```

**响应**：

```json
{
  "uploadUrl": "https://cn-nb1.rains3.com/wenyou/uploads/.../xxx.jpg?X-Amz-...",
  "mediaId": "clxabc123...",
  "objectKey": "uploads/2026/07/28/user_k7x3/1753728000000-a1b2c3.jpg",
  "publicUrl": "https://cn-nb1.rains3.com/wenyou/uploads/.../xxx.jpg"
}
```

| 字段 | 用途 |
|------|------|
| `uploadUrl` | 预签名 PUT URL，客户端凭此直传文件体 |
| `mediaId` | **贯穿全链路的媒体追踪 ID**，后续 upload-done / 查询 / 头像设置统一使用 |
| `objectKey` | S3 对象键（仅供参考，一般不需要手动处理） |
| `publicUrl` | 拼接生成的公网访问地址 |

**S3 命令参数**：
```
PutObjectCommand {
  Bucket, Key, ContentType, ContentLength,
  Expires: 600
}
```
`ContentLength` 参与签名，S3 侧拒绝长度不匹配的 PUT 请求。

---

## Step 2: 客户端直传

客户端收到 `uploadUrl` 后，直接发送 `PUT` 请求到该地址，请求体为文件的原始二进制内容。

```
PUT {uploadUrl}
Content-Type: image/jpeg
Body: <binary>
```

> 此步骤完全绕过服务端。Credentials 已编码在预签名 URL 的 `X-Amz-*` 查询参数中，客户端无需持有 AccessKey。

---

## Step 3: 上传确认

**端点**：`POST /media/upload-done`（需 `@Auth()` 登录 + 邮箱验证）

**请求 DTO**：

```typescript
class ConfirmUploadDto {
  mediaId: string;  // Step 1 返回的 mediaId
}
```

**处理流程**：
1. 根据 `mediaId` 查 Media 记录，校验归属（userId 匹配）
2. 校验 `status === 'UPLOADING'`，防止重复确认
3. 向 S3 发送 `GetObjectCommand` 检查对象是否存在
4. SVG 文件：直接转 `COMPLETED`
5. 非 SVG 文件：入队 BullMQ `image` 队列，转 `PROCESSING`

**重试策略**：
- 最多 2 次尝试
- 固定 10 秒间隔
- 成功任务 24h 后清理，失败任务 7d 后清理
- 末次重试仍失败 → 标记 `status=FAILED`

---

## Step 4: 查询处理状态

**端点**：`GET /media/:id`（需 `@Auth()` 登录 + 邮箱验证）

客户端轮询此端点获知缩略图是否就绪：

```json
{
  "id": "clx...",
  "status": "COMPLETED",
  "url": "https://...",
  "width": 1920,
  "height": 1080,
  "size": 204800
}
```

**状态机**：

```
UPLOADING ──(SVG)──> COMPLETED
    │
    └──(upload-done)──> PROCESSING ──(成功)──> COMPLETED
                                    └─(失败耗尽)──> FAILED
```

---

## Step 5: 异步图片处理

**消费者**：`ImageProcessor`，监听 `image` 队列

**处理函数**：`MediaService.processImage()`

### 完整流程

```
                    ImageProcessor
                         │
                         ▼
            ① S3 GetObject 下载原图到内存 Buffer
                         │
                         ▼
            ② sharp metadata() 读取原始尺寸
                         │
           ┌─────────────┴─────────────┐
           ▼                           ▼
   ③ sharp resize(300x300)    ④ sharp resize(800⨉null)
      fit: cover                    fit: inside
      webp quality: 80              webp quality: 85
      Cache-Control: immutable       Cache-Control: immutable
           │                           │
           ▼                           ▼
     {key}_thumb.webp             {key}_md.webp
           │                           │
           └─────────────┬─────────────┘
                         ▼
            ⑤ 上传两份加工产物到 S3
                         │
                         ▼
            ⑥ 更新 Media 记录：
               width / height / size / status=COMPLETED
```

### sharp 参数详解

| 产物 | 参数 | 说明 |
|------|------|------|
| **缩略图** | `resize(300, 300, { fit: 'cover' })` | 裁剪填充 300×300，`withoutEnlargement: true` |
| **缩略图** | `.webp({ quality: 80 })` | 平衡体积与质量 |
| **中图** | `resize(800, null, { fit: 'inside' })` | 等比缩放至宽度 ≤ 800px |
| **中图** | `.webp({ quality: 85 })` | 中图质量略高于缩略图 |

---

## 头像设置

**端点**：`PATCH /users/me/avatar`（需 `@Auth()` 登录 + 邮箱验证）

```json
{ "mediaId": "clx..." }
```

校验链：
1. media 记录存在 → 404
2. `media.userId === currentUser` → 403
3. `media.status === 'COMPLETED'` → 400
4. 写入 `user.avatar = media.url`

---

## 环境配置

所有 S3 配置通过 `ConfigService` 以 `cos.*` 前缀读取。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `COS_ENDPOINT` | `https://cn-nb1.rains3.com` | S3 兼容端点地址 |
| `COS_REGION` | `auto` | 区域标识 |
| `COS_BUCKET` | `wenyou` | 存储桶名称 |
| `COS_ACCESS_KEY_ID` | *(空，需设置)* | AccessKey |
| `COS_SECRET_ACCESS_KEY` | *(空，需设置)* | SecretKey |

`forcePathStyle: true` — 路径风格 URL（`{endpoint}/{bucket}/{key}`），兼容所有 S3 兼容实现。
