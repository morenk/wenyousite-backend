# 用户旅程：图片上传

> 通过预签名 URL 直传 S3，服务端异步生成缩略图和中图的完整流程。

## AI 执行摘要

- **涉及页面**：编辑器图片插入 / 头像上传 / 任意需要图片的页面
- **涉及接口**：`POST /media/upload-url`、`PUT {uploadUrl}`、`POST /media/upload-done`、`GET /media/:id`
- **关键状态**：`UPLOADING` → `PROCESSING` → `COMPLETED` / `FAILED`
- **常见错误**：`40000` 文件类型不支持/超过 10MB、`40001` 上传确认失败

---

## 整体流程

```
前端选择文件
    ↓
POST /media/upload-url
    ↓  返回 { mediaId, uploadUrl, publicUrl }
PUT uploadUrl（直传 S3）
    ↓
POST /media/upload-done
    ↓
轮询 GET /media/:id 直到 status=COMPLETED
    ↓
拿到最终 URL 插入编辑器或设置头像
```

---

## 第一步：获取预签名上传 URL

```http
POST /api/v1/media/upload-url
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "filename": "photo.jpg",
  "contentType": "image/jpeg",
  "size": 204800
}
```

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| filename | string | 是 | 原始文件名，仅用于提取扩展名 |
| contentType | string | 是 | MIME 类型，必须在白名单内 |
| size | number | 是 | 文件大小（字节），最大 10MB |

### 支持的 MIME 类型

| MIME Type | 扩展名 | 处理方式 |
|-----------|--------|----------|
| `image/jpeg` | jpg / jpeg | sharp 生成缩略图 + 中图 |
| `image/png` | png | sharp 生成缩略图 + 中图 |
| `image/gif` | gif | sharp 生成缩略图 + 中图 |
| `image/webp` | webp | sharp 生成缩略图 + 中图 |
| `image/avif` | avif | sharp 生成缩略图 + 中图 |
| `image/svg+xml` | svg | 跳过 sharp，直接 COMPLETED |

### 响应

```json
{
  "code": 0,
  "data": {
    "uploadUrl": "https://cn-nb1.rains3.com/wenyou/uploads/.../xxx.jpg?X-Amz-...",
    "mediaId": "clx...",
    "objectKey": "uploads/2026/07/28/user_k7x3/1753728000000-a1b2c3.jpg",
    "publicUrl": "https://cn-nb1.rains3.com/wenyou/uploads/.../xxx.jpg"
  }
}
```

**前端必须保存**：
- `mediaId`：后续 upload-done 和查询状态都需要
- `uploadUrl`：直传 S3 用
- `publicUrl`：原图访问地址（处理完成前不要直接使用）

---

## 第二步：直传 S3

```http
PUT {uploadUrl}
Content-Type: image/jpeg

<文件二进制内容>
```

**注意**：
- 请求体必须是文件的原始二进制内容。
- `Content-Type` 必须与请求 upload-url 时的一致。
- 文件大小必须与请求 upload-url 时的一致（S3 会校验）。
- 此请求不经过温油站服务端，直接上传到 S3。

### 前端实现（Web）

```typescript
const file = input.files[0];
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': file.type },
  body: file,
});
```

### 前端实现（Flutter）

```dart
final dio = Dio();
await dio.put(
  uploadUrl,
  data: File(filePath).openRead(),
  options: Options(headers: { 'Content-Type': fileMimeType }),
);
```

---

## 第三步：确认上传完成

```http
POST /api/v1/media/upload-done
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "mediaId": "clx..."
}
```

### 响应

```json
{
  "code": 0,
  "data": {
    "id": "clx...",
    "status": "PROCESSING",
    "url": "https://..."
  }
}
```

- SVG 文件会直接返回 `status: "COMPLETED"`。
- 其他图片会返回 `status: "PROCESSING"`，需要轮询查询状态。

---

## 第四步：轮询处理状态

```http
GET /api/v1/media/:mediaId
Authorization: Bearer <accessToken>
```

### 状态机

```
UPLOADING ──(SVG)──> COMPLETED
    │
    └──(upload-done)──> PROCESSING ──(成功)──> COMPLETED
                                    └─(失败)──> FAILED
```

### 响应示例（处理完成）

```json
{
  "code": 0,
  "data": {
    "id": "clx...",
    "status": "COMPLETED",
    "url": "https://.../xxx.jpg",
    "width": 1920,
    "height": 1080,
    "size": 204800
  }
}
```

### 响应示例（处理中）

```json
{
  "code": 0,
  "data": {
    "id": "clx...",
    "status": "PROCESSING",
    "url": "https://.../xxx.jpg"
  }
}
```

### 响应示例（失败）

```json
{
  "code": 0,
  "data": {
    "id": "clx...",
    "status": "FAILED",
    "url": "https://.../xxx.jpg"
  }
}
```

### 轮询策略

- 初始等待 500ms
- 之后每 1 秒查询一次
- 最多轮询 30 次（30 秒）
- 处理完成后停止轮询
- 失败后显示"图片处理失败，请重试"

---

## 生成的图片规格

上传完成后，服务端会通过 sharp 生成两张派生图：

| 规格 | 文件名后缀 | 尺寸 | 格式 | 用途 |
|------|-----------|------|------|------|
| 缩略图 | `_thumb.webp` | 300×300 cover | WebP | 列表预览、头像 |
| 中图 | `_md.webp` | 宽度 ≤ 800px，等比缩放 | WebP | 正文展示 |

**URL 推导**：

如果原图 URL 是：
```
https://.../xxx.jpg
```

那么：
- 缩略图：`https://.../xxx_thumb.webp`
- 中图：`https://.../xxx_md.webp`

前端可以直接按此规则拼接，也可以只使用原图 URL，由需要时替换后缀。

---

## 编辑器中插入图片

Markdown 中图片使用标准语法：

```markdown
![描述](https://.../xxx_md.webp)
```

建议：
- 默认插入中图 URL（`_md.webp`）。
- 点击放大时展示原图 URL。
- 列表预览使用缩略图 URL（`_thumb.webp`）。

---

## 头像上传

头像上传也走同样的图片上传流程，但上传完成后需要再调用：

```http
PATCH /api/v1/users/me/avatar
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "mediaId": "clx..."
}
```

**头像设置校验**：
- media 必须存在
- media 必须属于当前用户
- media 状态必须是 `COMPLETED`

---

## 前端实现建议

### 封装上传函数

```typescript
async function uploadImage(file: File): Promise<string> {
  // 1. 获取上传 URL
  const { data } = await api.post('/media/upload-url', {
    filename: file.name,
    contentType: file.type,
    size: file.size,
  });

  const { mediaId, uploadUrl } = data.data;

  // 2. 直传 S3
  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });

  // 3. 确认上传
  await api.post('/media/upload-done', { mediaId });

  // 4. 轮询状态
  for (let i = 0; i < 30; i++) {
    const statusRes = await api.get(`/media/${mediaId}`);
    if (statusRes.data.data.status === 'COMPLETED') {
      return statusRes.data.data.url;
    }
    if (statusRes.data.data.status === 'FAILED') {
      throw new Error('图片处理失败');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error('图片处理超时');
}
```

### 上传前校验

- 文件类型：从 file.type 判断是否在白名单内。
- 文件大小：file.size <= 10 * 1024 * 1024。
- 不支持的类型或超过大小，在上传前就给用户提示。

### 上传进度

Web：`XMLHttpRequest` 或 `axios` 的 `onUploadProgress`。

```typescript
await axios.put(uploadUrl, file, {
  headers: { 'Content-Type': file.type },
  onUploadProgress: (e) => {
    const progress = Math.round((e.loaded / e.total) * 100);
    setProgress(progress);
  },
});
```

Flutter：Dio 的 `onSendProgress`。

---

## 错误处理

| 场景 | 错误 | 前端提示 |
|------|------|---------|
| 文件类型不支持 | 40000 | "仅支持 jpg/png/gif/webp/avif/svg 格式" |
| 文件超过 10MB | 40000 | "图片大小不能超过 10MB" |
| S3 直传失败 | 网络错误 | "上传失败，请检查网络后重试" |
| 上传确认失败 | 40001 | "文件不存在或上传不完整，请重试" |
| 处理失败 | status=FAILED | "图片处理失败，请重新上传" |
| 处理超时 | — | "图片处理超时，请稍后刷新查看" |

---

## 状态机

```
[选择文件]
   │
   ▼
[校验类型/大小]
   │
   ├─ 不通过 ──> 提示错误
   │
   ▼
[POST /media/upload-url] ──> UPLOADING
   │
   ▼
[PUT uploadUrl 直传 S3]
   │
   ├─ 失败 ──> 提示重试
   │
   ▼
[POST /media/upload-done]
   │
   ├─ SVG ──> COMPLETED
   │
   ▼
PROCESSING
   │
   ├─ 轮询成功 ──> COMPLETED
   │
   └─ 轮询失败 ──> FAILED
```
