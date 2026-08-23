# 图片上传管线

## 架构决策

温油站采用“客户端预处理 + 预签名直传 + 临时对象归一化”。HTTP 服务不转发图片字节，也不运行 sharp。客户端上传的字节只在随机 `staging/` 对象中短暂停留；独立图片 Worker 生成正式主图后立即删除临时对象。静态原件不长期保存，GIF 为保留动画语义的例外。

```text
客户端
  ├─ 1. POST /media/upload-url（声明文件与 purpose）
  ├─ 2. PUT 预签名 URL → staging 临时对象
  ├─ 3. POST /media/upload-done
  └─ 4. GET /media/:id 轮询
                         │
                         ▼
                BullMQ image 队列
                         │
                         ▼
                独立 Image Worker
                  ├─ 下载与安全检查
                  ├─ 标准化主图
                  ├─ 按用途生成派生图
                  ├─ 写正式对象和数据库
                  └─ 删除临时对象
```

这样可以保证：

- `mediaId` 从签名开始贯穿确认、轮询与业务绑定；
- 大文件不经过 NestJS HTTP 进程，图片解码也不会阻塞 HTTP 事件循环；
- 正式存储只有标准化静态 WebP 主图或受限 GIF，不保留静态 EXIF 与原始编码；
- `purpose` 决定最小派生集，避免所有图片都生成无人使用的尺寸。

## 1. 获取上传凭证

`POST /media/upload-url` 需要登录，正文如下：

| 字段 | 类型 | 规则 | 说明 |
| --- | --- | --- | --- |
| `filename` | string | 1–255 字符 | 只用于安全提取扩展名 |
| `contentType` | string | jpeg/png/gif/webp/avif | SVG 永久拒绝 |
| `size` | number | 1–10 MiB | 参与 PUT 签名 |
| `purpose` | enum，可选 | `MediaPurpose` | 旧客户端省略时为 `LEGACY` |

用途枚举为 `AVATAR / PROFILE_COVER / DIRECT_MESSAGE / MOMENT / MOMENT_COMMENT / RICH_CONTENT / STICKER_SOURCE / LEGACY`。新客户端应按实际入口传值；业务绑定接口接受同用途或历史 `LEGACY` 媒体，以保持已发布移动端兼容。

对象键分为两个生命周期：

```text
staging/YYYY/MM/DD/{userId}/{timestamp}-{random}.{sourceExt}
media/YYYY/MM/DD/{userId}/{timestamp}-{random}.webp|gif
```

响应示例：

```json
{
  "uploadUrl": "https://storage.example/...signed...",
  "mediaId": "clxabc123",
  "objectKey": "staging/2026/08/23/user1/123-random.jpg",
  "publicUrl": "https://storage.example/wenyou/media/2026/08/23/user1/123-random.webp"
}
```

`objectKey` 只表示本次 PUT 的临时对象，客户端不得拼接读取地址或持久化它。`publicUrl` 是处理完成后的正式地址，在状态变为 `COMPLETED` 前不得读取。预签名有效期 600 秒，`Content-Type` 与 `Content-Length` 都参与签名。

## 2. 客户端预处理与直传

Web 对非 GIF 图片先执行：

1. 按 EXIF 方向解码归正；
2. 最长边限制为 2560px，不放大小图；
3. 通过 Canvas 清除元数据；
4. 编码为质量约 85 的 WebP；
5. 使用处理后的 MIME、文件名和大小申请签名并 PUT。

GIF 不做静态转码，避免丢失动画。Flutter 应在 Windows 开发环境实现相同策略；VPS 移动端副本只作兼容审查。客户端预处理只用于减少上行流量和等待时间，服务端不能信任它，Worker 仍会重复检查和归一化。

直传中断或确认发现对象尚不存在时，调用 `POST /media/:id/upload-url` 为同一个 `mediaId` 和临时 key 重签；不会创建新记录或重复计入小时配额。

## 3. 上传确认

`POST /media/upload-done` 接收 `{ "mediaId": "..." }`：

1. 校验记录归属和当前状态；
2. 对临时对象执行 HEAD，实际大小、MIME 必须与签名声明一致；
3. 对象尚不存在返回 HTTP 404 / `MEDIA_OBJECT_MISSING`，客户端可同 ID 重传；
4. 条件更新 `UPLOADING → PROCESSING`，并发确认只有一个取得入队权；
5. 以 `mediaId` 作为 BullMQ `jobId` 入队，失败时条件回滚到 `UPLOADING`。

任务最多尝试 2 次，固定退避 10 秒；成功任务保留 24 小时，失败任务保留 7 天。确认接口本身不会等待图片转码。

## 4. 查询处理状态

`GET /media/:id` 返回正式 URL、状态、尺寸、用途和动画标记：

```json
{
  "id": "clxabc123",
  "status": "COMPLETED",
  "url": "https://storage.example/wenyou/media/...webp",
  "thumbnailUrl": "https://storage.example/wenyou/media/..._thumb.webp",
  "feedUrl": null,
  "mediumUrl": "https://storage.example/wenyou/media/..._md.webp",
  "contentType": "image/webp",
  "size": 204800,
  "width": 1920,
  "height": 1080,
  "purpose": "DIRECT_MESSAGE",
  "animated": false
}
```

派生 URL 在 `COMPLETED` 前或该用途不生成对应尺寸时为 `null`。客户端只使用服务端返回的非空 URL，不猜测 key；列表优先缩略图，正文预览优先中图，缺失时回退正式 `url`。

```text
UPLOADING ──(元数据非法)──────────────> FAILED
    │
    └──(确认并入队)──> PROCESSING ──(成功)──> COMPLETED
                                  └─(重试耗尽)──> FAILED
```

## 5. Worker 归一化

`wenyousite-image-worker.service` 只加载图片队列消费者。BullMQ 并发为 2，进程级 sharp 并发为 1，以可预测的 CPU/内存占用换取 HTTP 稳定性。

静态图片处理规则：

- 真实解码格式必须与上传声明一致；非 GIF 多帧输入拒绝；
- 输入最多 6400 万像素；
- 自动旋转，最长边缩至 2560px，不放大；
- 清除元数据，编码为 WebP 85（透明通道质量 100）；
- 正式主图和派生图使用一年 immutable 缓存。

GIF 以原字节写入正式对象，限制最长边 2560px、最多 300 帧、总时长 60 秒、累计 1 亿像素。`animated=true`，只按用途生成静态缩略图。

用途派生矩阵：

| purpose | 300px 缩略图 | 480px 信息流图 | 800px 中图 |
| --- | --- | --- | --- |
| `AVATAR / PROFILE_COVER / STICKER_SOURCE` | — | — | — |
| `DIRECT_MESSAGE / MOMENT_COMMENT` | 是 | — | 是 |
| `MOMENT / RICH_CONTENT / LEGACY` | 是 | 是 | 是 |

Worker 写正式对象和数据库成功后删除 staging 对象；最终失败也删除。删除偶发失败时保留 `stagingKey`，每日维护任务继续补偿。日志以机器字段记录队列等待、下载、检查、归一化、派生、上传、数据库和清理耗时，供压力测试定位瓶颈。

## 6. 业务绑定

头像、主页双画幅、私聊、动态、动态评论、Markdown 正文和表情导入都必须绑定本人 `COMPLETED` 的媒体，并校验 `purpose`。旧客户端创建的 `LEGACY` 媒体在兼容期仍可绑定；新客户端不得依赖这一降级。

头像和主页背景由客户端先裁剪成最终画幅，因此只保留标准化主图，不生成通用派生图。静态主图 URL 的扩展名为 `.webp`；GIF 正式 URL 为 `.gif`。

## 7. 配置与清理

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COS_ENDPOINT` | `https://cn-nb1.rains3.com` | S3 兼容端点 |
| `COS_REGION` | `auto` | 区域 |
| `COS_BUCKET` | `wenyou` | 正式与临时对象桶；生产策略应禁止公开列举 `staging/` |
| `COS_ACCESS_KEY_ID` | 空 | 服务端访问密钥 |
| `COS_SECRET_ACCESS_KEY` | 空 | 服务端访问密钥 |
| `UPLOAD_RATE_PER_HOUR` | `60` | 每用户每小时签名配额 |
| `MEDIA_COMPLETED_ORPHAN_CLEANUP_ENABLED` | `false` | 是否回收宽限期后的完成态孤儿媒体 |

每日任务会清理超过 24 小时未确认的上传、超过 7 天的失败记录、完成/失败记录残留的 staging 对象，以及开关启用后超过宽限期且仍无引用的完成态媒体。删除正式对象后才删除数据库记录；失败时保留事实记录供下次重试。

本次 `purpose` 与存储策略不需要进入 Foundation：它们属于媒体 HTTP 契约和后端资源策略，不是跨端 UI 或领域基础类型。
