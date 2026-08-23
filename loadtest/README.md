# 压力测试

所有写入压测只允许在隔离数据库、隔离 Redis 和专用对象桶中运行。不要把 `media.js` 指向公网开发环境：它会创建真实媒体记录、队列任务和对象，并消耗上行、存储与 API 配额。

## 配置文件

先分别填写两个本地配置文件：

```bash
cp loadtest/target.env.example loadtest/target.env
cp loadtest/runner.env.example loadtest/runner.env
```

- `target.env` 只放隔离后端、Worker、PostgreSQL、Redis 和 RainS3 测试实例配置，应留在目标服务器。
- `runner.env` 只放隔离公网入口、Windows 压测机固定 IP、k6 参数和结果路径，应留在本地 Windows 压测机。
- 两个实际文件已被 Git 忽略；`.example` 文件不包含任何密钥。
- `AUTH_TOKENS_JSON_PATH` 指向的 Token 文件由隔离环境初始化阶段生成，不要把正式账号 Token 填入配置。

当前目标服务器公网 DNS 可使用 `loadtest-api.wenyou.site`。压测机不需要入站公网 IP；Windows 经路由器/NAT发起请求时，填写服务器实际看到的公网出口 IP，并同步到 `target.env` 的 `LOADTEST_ALLOWED_IP`、`runner.env` 的 `LOADGEN_IP` 和入口/WAF 白名单中。出口 IP 动态变化时，在每轮测试前更新即可。

## VPS 隔离基础设施

隔离 PostgreSQL 和 Redis 由本仓库唯一的 Compose 以 `loadtest` profile 管理，不会复用正式容器、端口或数据卷。填写 `target.env` 的 `LOADTEST_DB_PASSWORD` 后，在 VPS 执行：

```bash
docker compose --env-file loadtest/target.env --profile loadtest up -d loadtest-postgres loadtest-redis
docker compose --env-file loadtest/target.env --profile loadtest ps
```

隔离数据库监听 `127.0.0.1:55432`，隔离 Redis 监听 `127.0.0.1:56379`。不要对公网开放这两个端口；公网只暴露后续配置的压测 API 入口。

隔离后端和图片 Worker 使用 `ops/wenyousite-loadtest-*.service`，其运行时覆盖配置放在被 Git 忽略的 `loadtest/backend.env`。该 unit 只监听后端的隔离端口，不会替换正式 systemd unit。

在 VPS 的后端仓库中生成 40 个隔离账号及其 access token（输出文件不会进入 Git）：

```bash
pnpm loadtest:tokens
```

将生成的 `loadtest/auth-tokens.json` 通过安全渠道复制到 Windows 压测机的同一路径；脚本会复用隔离账号、吊销旧移动会话并签发默认 2 小时的 access token（可用 `LOADTEST_ACCESS_TOKEN_TTL` 覆盖）。

## Windows 执行

官方 k6 支持 Windows。可使用 Windows Package Manager 安装：

```powershell
winget install k6 --source winget
k6 version
```

在后端仓库目录执行：

```powershell
pnpm install
pnpm loadtest:fixtures
Copy-Item loadtest\runner.env.example loadtest\runner.env
# 填写 loadtest\runner.env，并把隔离环境生成的 auth-tokens.json 放到对应路径
.\loadtest\run-core.ps1
.\loadtest\run-media.ps1
```

PowerShell 启动脚本会读取 `runner.env`、创建 `loadtest\results`，并分别保存核心读取和媒体处理摘要。Windows 不需要运行 SSH 服务；Token 文件由隔离环境生成后通过安全渠道提供。

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
