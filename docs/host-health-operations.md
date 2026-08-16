# 宿主机健康巡检与延迟排查

本文用于定位 API 突发 5xx、长时间无响应和 Prisma 事务超时。巡检只写入本机 systemd journal，不向外部服务发送数据，也不会自动重启后端或数据库。

## 2026-08-16 事故结论

09:56–10:00 UTC 期间，Web 与移动端共用的 3000 后端出现间歇 500。证据链如下：

- `wenyousite-backend.service` 始终 active，期间没有重启；这不是后端进程崩溃或认证端口单独下线。
- 钱包签到、动态点赞和 `/auth/refresh` 先后出现 Prisma `P2028 Transaction already closed`，耗时约 6–84 秒，说明影响并不限于认证模块。
- PostgreSQL 在 09:57:28 完成的 checkpoint 只写 50 个 buffer，却耗时 19.77 秒。
- 10:00 的 sysstat 记录显示 I/O PSI `full avg10=93.62%`、磁盘 await 约 `278 ms`、4 核机器 load 约 `11.42`，同时可用内存正常。

因此可确认的直接原因是宿主机块存储在该时段严重阻塞，拖延 PostgreSQL 事务并引发 API 500；现有历史采样不足以进一步区分云盘底层抖动与同宿主机 I/O 争用。服务自行恢复且进程没有重启，也与短时存储抖动一致。

故障期间连续发码产生多封邮件，是因为 HTTP 客户端先超时，但服务端在数据库恢复后继续完成了多次 SMTP 调用。认证服务现已用数据库发送占位按接收者和验证码用途做 60 秒原子冷却；失败或结果不明也保留冷却，不依赖单一客户端 IP 限流。

## 安装与查看巡检

仓库中的 unit 每分钟执行一次轻量采样：

```bash
install -m 0644 ops/wenyousite-host-health.service /etc/systemd/system/
install -m 0644 ops/wenyousite-host-health.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wenyousite-host-health.timer
```

正常样本不写日志；任一阈值触发时输出一行 `host_health_warning`。默认阈值为 I/O PSI full avg10 `20%`、根盘 await `100 ms`、本机健康接口 `2000 ms`，并额外记录最近两分钟的 HTTP 5xx、Prisma 事务关闭次数、负载、可用内存和后端重启数。可通过 `WENYOU_IO_PSI_FULL_AVG10_WARN`、`WENYOU_DISK_AWAIT_WARN_MS`、`WENYOU_HEALTH_WARN_MS` 调整。

```bash
systemctl list-timers wenyousite-host-health.timer
journalctl -u wenyousite-host-health.service --since '-30 minutes' --no-pager
```

巡检输出不包含请求正文、邮箱、验证码、Cookie 或 token。

## 出现告警时

尽快保留最近时间窗的脱敏证据：

```bash
bash scripts/diagnose-latency.sh 30
```

脚本汇总服务状态、后端 5xx/事务超时、PostgreSQL checkpoint、当前 PSI/iostat、sysstat 历史和巡检 journal。若根盘持续高延迟，先停止扩大部署或批量任务；确认数据库和本机健康恢复后再验证公网健康。巡检不会自动重启，避免在存储仍阻塞时把故障放大。

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/health >/dev/null
curl --fail --silent --show-error https://wenyou.site/api/v1/health >/dev/null
```
