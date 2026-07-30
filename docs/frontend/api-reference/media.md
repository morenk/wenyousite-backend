# API 速查：媒体（Media）

> 图片上传：预签名 URL、直传 S3、上传确认、状态查询。

## 端点总览

| Method | Path | 认证 | 用途 |
|--------|------|------|------|
| POST | `/media/upload-url` | Auth | 获取预签名上传 URL |
| POST | `/media/upload-done` | Auth | 确认上传完成 |
| GET | `/media/:id` | Auth | 查询处理状态 |

---

## POST /media/upload-url

获取 S3 预签名上传 URL，同时预建 Media 记录（`status=UPLOADING`）。

### 请求

```json
{
  "filename": "photo.jpg",
  "contentType": "image/jpeg",
  "size": 204800
}
```

### 字段

| 字段 | 类型 | 必填 | 限制 |
|------|------|------|------|
| filename | string | 是 | Max 255 |
| contentType | string | 是 | 必须在 MIME 白名单 |
| size | number | 是 | 1 - 10,485,760 字节 |

### MIME 白名单

- `image/jpeg`
- `image/png`
- `image/gif`
- `image/webp`
- `image/avif`
- `image/svg+xml`

### 响应

```json
{
  "code": 0,
  "data": {
    "uploadUrl": "https://...?X-Amz-...",
    "mediaId": "clx...",
    "objectKey": "uploads/2026/07/28/.../xxx.jpg",
    "publicUrl": "https://.../xxx.jpg"
  }
}
```

---

## PUT {uploadUrl}

客户端直传 S3，不经过温油站服务端。

```http
PUT {uploadUrl}
Content-Type: image/jpeg

<二进制文件内容>
```

---

## POST /media/upload-done

确认上传完成，触发异步图片处理。

### 请求

```json
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
    "url": "https://.../xxx.jpg"
  }
}
```

---

## GET /media/:id

查询图片处理状态。

### 状态

| 状态 | 含义 |
|------|------|
| `UPLOADING` | 已获取上传 URL，尚未确认上传 |
| `PROCESSING` | 上传确认成功，正在生成缩略图和中图 |
| `COMPLETED` | 处理完成 |
| `FAILED` | 处理失败 |

### 响应

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

---

## 派生图 URL 规则

| 规格 | URL 后缀 | 用途 |
|------|---------|------|
| 原图 | 无 | 点击查看大图 |
| 中图 | `_md.webp` | 正文展示 |
| 缩略图 | `_thumb.webp` | 列表预览、头像 |

---

## 状态机

```
UPLOADING ──(SVG)──> COMPLETED
    │
    └──(upload-done)──> PROCESSING ──(成功)──> COMPLETED
                                    └─(失败)──> FAILED
```

---

## 前端使用场景

| 场景 | 调用顺序 |
|------|---------|
| 编辑器插入图片 | upload-url → PUT S3 → upload-done → 轮询 → 插入 Markdown |
| 设置头像 | upload-url → PUT S3 → upload-done → 轮询 → PATCH /users/me/avatar |
| 任意需要 mediaId 的地方 | 上传完成后拿到 mediaId 即可 |
