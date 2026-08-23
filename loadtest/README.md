# 压力测试

所有写入压测只允许在隔离数据库、隔离 Redis 和专用对象桶中运行。不要把 `media.js` 指向公网开发环境：它会创建真实媒体记录、队列任务和对象，并消耗上行、存储与 API 配额。

## 基线模型

- `core.js`：500 个在线会话每 30 秒轮询一次；100 个预分配活跃 VU 以 50 RPS 读取核心接口；第 8 分钟升至 150 RPS，持续 1 分钟后回落。
- `media.js`：4 个完整上传/秒，文件大小按小/中/大 `70% / 25% / 5%` 分布，业务用途混合私聊、动态、正文和头像；每次包含签名、PUT、确认和完成态轮询。
- 媒体默认门槛：失败率低于 1%，签名 p95 < 500ms，确认 p95 < 750ms，服务端处理 p95 < 30s，端到端 p95 < 45s，不能丢迭代。

先生成不会提交到 Git 的 PNG 测试夹具：

```bash
pnpm loadtest:fixtures
```

核心读压测：

```bash
k6 run -e BASE_URL=http://127.0.0.1:3000 \
  -e SUMMARY_PATH=/tmp/core-summary.json loadtest/core.js
```

媒体压测至少准备 40 个专用账号 token，避免默认每用户 60 次/小时配额改变测试含义：

```bash
export AUTH_TOKENS='["token-1","...","token-40"]'
k6 run \
  -e BASE_URL=http://127.0.0.1:3000 \
  -e AUTH_TOKENS="$AUTH_TOKENS" \
  -e SUMMARY_PATH=/tmp/media-summary.json loadtest/media.js
```

## MinIO 与 RainS3 对照

使用同一后端提交、数据库初始快照、Redis 配置、Worker 并发、压测机和夹具，各运行一次完整预热与正式测试。只改变后端的 `COS_ENDPOINT / COS_REGION / COS_BUCKET / COS_ACCESS_KEY_ID / COS_SECRET_ACCESS_KEY`，分别指向本地/同机房 MinIO 与隔离的 RainS3 测试桶。每轮结束保存：

- k6 JSON summary；
- API、Worker 的 CPU 峰值、RSS、事件循环延迟和 5xx/429；
- Redis `image` 队列 waiting/active/failed 深度；
- 对象存储 PUT/GET 延迟、错误率和流量；
- staging 残留数量、正式对象数量与存储增量。

聚合 Worker 分段日志：

```bash
journalctl -u wenyousite-image-worker.service --since '10 minutes ago' --no-pager \
  | pnpm media:latency:summary
```

先判断瓶颈再调并发：`queueWaitMs` 持续增长说明吞吐不足；`downloadMs/uploadMs` 主导说明对象存储或网络受限；`normalizeMs/variantsMs` 主导且 CPU 饱和说明 sharp 受限；HTTP 延迟随 Worker 压力上升则说明进程隔离或宿主机资源预算仍不足。只有在 RSS 与 CPU 有余量、staging 能稳定清空时才逐级把 Worker 队列并发从 2 提高。

压测数据通过正常孤儿媒体生命周期清理，不物理删除审计或账本。每轮应换空的隔离桶和数据库快照，确保两种对象存储结果可比。
