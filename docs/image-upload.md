# 图片上传管线

## 架构决策

温油站采用 **预签名直传**（Pre-signed Upload）模型，服务端只负责签发凭证和后续处理，原始文件字节流不经过服务端。

```
┌──────────┐  ① POST /media/upload-url   ┌──────────┐
│          │ ──── filename/contentType ──> │          │
│  客户端   │ <── { uploadUrl, key, url }  │  NestJS   │
│          │                              │  服务端   │
│          │  ② PUT uploadUrl (binary)    │          │
│          │ ─────── 直传 S3 ──────────> │          │
│          │                              │          │
│          │  ③ POST /media/upload-done  │          │
│          │ ───── { objectKey } ────────>│          │
│          │                              │     │
└──────────┘                              │     │ ④ BullMQ image 队列
                                          │     ▼
                                          │ ImageProcessor
                                          │     │
                                          │     │ ⑤ sharp 加工
                                          │     ▼
                                          │   写回 S3
                                          └──────────┘
```

**优势**：
- 服务端零 IO 压力，大文件上传不占用应用进程内存
- 600 秒预签名有效期，足够移动端弱网环境
- 对象存储直接暴露公网 URL，无需反向代理转发

---

## Step 1: 获取上传凭证

**端点**：`POST /media/upload-url`（需 `@AuthRead()` 登录守卫）

**请求 DTO**（`src/media/dto/upload.dto.ts:11`）：

| 字段 | 类型 | 校验规则 | 说明 |
|------|------|----------|------|
| `filename` | `string` | `@MinLength(1) @MaxLength(255)` | 原始文件名，仅用于提取扩展名 |
| `contentType` | `string` | `@IsIn(ALLOWED_MIME)` | MIME 白名单校验 |
| `size` | `number` | `@Min(1) @Max(10485760)` | 文件大小（字节），上限 10MB |

**MIME 白名单**（`src/media/media.service.ts:13`）：

| MIME Type | 扩展名 | 支持处理 |
|-----------|--------|----------|
| `image/jpeg` | jpg / jpeg | sharp 缩略图 + 中图 |
| `image/png` | png | sharp 缩略图 + 中图 |
| `image/gif` | gif | sharp 缩略图 + 中图 |
| `image/webp` | webp | sharp 缩略图 + 中图 |
| `image/avif` | avif | sharp 缩略图 + 中图 |
| `image/svg+xml` | svg | **跳过** sharp 处理 |

**文件名消毒**（`src/media/media.service.ts:192`）：

- 只取最后一段作为扩展名：`foo.bar.jpg` → `jpg`
- 剔除所有非字母数字字符：`image (1).jpg` → `jpg`
- 非白名单扩展名 / 空扩展名 / 超长扩展名 → fallback 为 `bin`
- 以上规则有效防御**双重扩展名攻击**（如 `photo.jpg.exe`）

**对象键生成规则**：

```
uploads/YYYY/MM/DD/{userId}/{timestamp}-{randomId}.{ext}
```

示例：`uploads/2026/07/28/user_k7x3/1753728000000-a1b2c3.jpg`

层级结构利用文件系统天然分桶，避免单目录下文件数膨胀。

**响应**（`src/media/media.service.ts:78`）：

```json
{
  "uploadUrl": "https://cn-nb1.rains3.com/wenyou/uploads/.../xxx.jpg?X-Amz-...",
  "objectKey": "uploads/2026/07/28/user_k7x3/1753728000000-a1b2c3.jpg",
  "publicUrl": "https://cn-nb1.rains3.com/wenyou/uploads/.../xxx.jpg"
}
```

| 字段 | 用途 |
|------|------|
| `uploadUrl` | 预签名 PUT URL，客户端凭此直传文件体 |
| `objectKey` | S3 对象键，上传确认时回传 |
| `publicUrl` | 拼接生成的公网访问地址 |

**S3 命令参数**（`src/media/media.service.ts:70`）：

```
PutObjectCommand {
  Bucket: "wenyou",
  Key: "uploads/.../xxx.jpg",
  ContentType: "image/jpeg",
  Expires: 600  // 10 分钟
}
```

---

## Step 2: 客户端直传

客户端收到 `uploadUrl` 后，直接发送 `PUT` 请求到该地址，请求体为文件的原始二进制内容。

```
PUT {uploadUrl}
Content-Type: image/jpeg
Body: <binary>
```

> 此步骤完全绕过服务端。Credentials 已编码在预签名 URL 的 `X-Amz-*` 查询参数中，客户端无需持有 AccessKey。

兼容的 S3 实现包括：**腾讯 COS**、**RainS3**、MinIO、Ceph、以及任意 nginx + S3 兼容网关。

---

## Step 3: 上传确认

**端点**：`POST /media/upload-done`（需 `@AuthRead()` 登录守卫）

**请求 DTO**（`src/media/dto/upload.dto.ts:31`）：

```typescript
class ConfirmUploadDto {
  objectKey: string;  // Step 1 返回的 objectKey
}
```

**处理流程**（`src/media/media.service.ts:86`）：

1. 向 S3 发送 `GetObjectCommand` 检查对象是否存在
2. 若 404 则抛 `NotFoundException('文件不存在或上传未完成')`
3. 写入 `Media` 表：

| 字段 | 值 |
|------|-----|
| `id` | cuid() 自动生成 |
| `userId` | 当前登录用户 |
| `url` | 拼接的公网访问地址 |
| `key` | S3 对象键 |

4. 若文件扩展名为 `.svg`：跳过图片处理，直接返回 `{ media, processing: false }`
5. 否则入队 BullMQ `image` 队列：

```typescript
{
  mediaId: media.id,
  objectKey: objectKey,
  bucket: "wenyou"
}
```

**重试策略**：
- 最多 2 次尝试（`attempts: 2`）
- 固定 10 秒间隔（`backoff: { type: 'fixed', delay: 10000 }`）
- 成功任务 24h 后清理，失败任务 7d 后清理

---

## Step 4: 异步图片处理

**消费者**：`ImageProcessor`（`src/jobs/image.processor.ts:8`），监听 `image` 队列

**处理函数**：`MediaService.processImage()`（`src/media/media.service.ts:123`）

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
              width / height / size
```

### sharp 参数详解

| 产物 | 参数 | 说明 |
|------|------|------|
| **缩略图** | `resize(300, 300, { fit: 'cover' })` | 裁剪填充 300×300，`withoutEnlargement: true` 防止小图放大模糊 |
| **缩略图** | `.webp({ quality: 80 })` | 平衡体积与质量 |
| **中图** | `resize(800, null, { fit: 'inside' })` | 等比缩放至宽度 ≤ 800px，高度自动计算 |
| **中图** | `.webp({ quality: 85 })` | 中图质量略高于缩略图 |

**关键细节**：
- `withoutEnlargement: true` — 原图小于目标尺寸时不做放大，保真
- 统一输出 WebP 格式，相比 JPEG/PNG 体积减少 30-50%
- 原图保持原始格式不动，加工产物追加为独立 S3 对象

**产物文件命名**：

| 产物 | 命名规则 | 示例 |
|------|----------|------|
| 原图 | `{key}` | `uploads/2026/07/28/.../abc.jpg` |
| 缩略图 | `{key}_thumb.webp` | `uploads/2026/07/28/.../abc_thumb.webp` |
| 中图 | `{key}_md.webp` | `uploads/2026/07/28/.../abc_md.webp` |

原图后缀可能是 `.jpg` / `.png` 等任意格式，`_thumb.webp` 和 `_md.webp` 固定为 WebP。替换策略利用 `key.replace(/(\.[^.]+)$/, '_thumb.webp')`。

**Media 表更新**（`src/media/media.service.ts:169`）：

```typescript
await this.prisma.media.update({
  where: { id: job.mediaId },
  data: {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    size: buffer.length,
  },
});
```

---

## 环境配置

所有 S3 配置通过 `ConfigService` 以 `cos.*` 前缀读取（`src/config/configuration.ts:32`）。

**环境变量清单**：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `COS_ENDPOINT` | `https://cn-nb1.rains3.com` | S3 兼容端点地址 |
| `COS_REGION` | `auto` | 区域标识 |
| `COS_BUCKET` | `wenyou` | 存储桶名称 |
| `COS_ACCESS_KEY_ID` | *(空，需设置)* | AccessKey |
| `COS_SECRET_ACCESS_KEY` | *(空，需设置)* | SecretKey |

**启动时校验**：所有环境变量经 `EnvironmentVariables` 类校验（`src/config/env.validation.ts:11`）。其中密钥字段在类型上仅为 `@IsString()`，不强制非空（dev 环境可缺省），但生产环境必须提供有效凭证。

**S3 客户端初始化**（`src/media/media.service.ts:42`）：

```typescript
this.s3 = new S3Client({
  endpoint: 'https://cn-nb1.rains3.com',
  region: 'auto',
  credentials: {
    accessKeyId: process.env.COS_ACCESS_KEY_ID,
    secretAccessKey: process.env.COS_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
```

`forcePathStyle: true` 采用路径风格 URL（`{endpoint}/{bucket}/{key}`），而非虚拟主机风格（`{bucket}.{endpoint}/{key}`），兼容所有 S3 兼容实现。

---

## BullMQ 队列配置

`image` 队列在两个模块中注册（NestJS 要求所有使用队列的模块显式注册）：

| 模块 | 位置 | 用途 |
|------|------|------|
| `JobsModule` | `src/jobs/jobs.module.ts:25` | 注册 Processor（`ImageProcessor` 在此消费） |
| `MediaModule` | `src/media/media.module.ts:9` | 注册 Producer（`MediaService` 在此投递任务） |

**队列注册代码**（`src/jobs/jobs.module.ts:25`）：

```typescript
BullModule.registerQueue(
  { name: 'notification', defaultJobOptions: { ... } },
  { name: 'image' },
)
```

**生产者注入**（`src/media/media.service.ts:40`）：

```typescript
@InjectQueue('image') private imageQueue: Queue
```

**消费者注册**（`src/jobs/image.processor.ts:7`）：

```typescript
@Processor('image')
export class ImageProcessor extends WorkerHost { ... }
```
