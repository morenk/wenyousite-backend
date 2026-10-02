# 2026-10-02 Backend 依赖安全补丁验收

基线为 `6eb742502feed44df822b964b451349919b65073`；仅在 VPS 独立 Worktree 执行，任务分支 `codex/20261002-backend-dependency-security`。

## 依赖范围

| 依赖 | 原版 | 修复版 |
| --- | --- | --- |
| @nestjs/platform-fastify | 11.2.3 | 11.2.5 |
| fastify | 5.12.1 | 5.12.5 |
| nodemailer | 10.0.2 | 10.0.9 |
| brace-expansion | 2.1.4 / 5.0.9 | 2.1.7 / 5.0.12 |
| fast-uri | 3.1.7 / 4.1.4 | 3.1.8 / 4.1.5 |
| @grpc/grpc-js | 1.14.4 | 1.14.5 |

基线生产审计有 20 条记录（12 高、7 中、1 低），涉及 16 份公告。直接依赖保持现有主版本；brace-expansion、fast-uri 和 Nest 的精确 Fastify 依赖沿用定向 overrides；grpc-js 仅按现有范围更新锁文件。Nest 新增的 @fastify/middie 9.3.4 是官方安全修复的一部分。移除旧 fast-uri 包龄豁免，不扩大包龄策略或审计忽略范围。

官方依据：[Nest 中间件路径判定](https://github.com/nestjs/nest/security/advisories/GHSA-9c5c-9qcx-q35q)、[Fastify 异常 URL](https://github.com/fastify/fastify/security/advisories/GHSA-p68q-wchp-6fh7)、[邮件地址解析](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-v53p-9fqp-m79j)、[引号地址边界](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-g57g-f23g-4646)、[glob 展开](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr)、[URI 规范化](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj)、[gRPC 证书上下文](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j)。

## 本地 CSRF 路由判定修复

单独升级框架不足以覆盖应用自己对原始 `request.url` 的前缀判断。真实回环临时 Fastify 服务原样注册旧 hook：缺失 CSRF 的普通管理 POST 返回 403，而同路由的绝对形式 HTTP 请求返回 200 并进入模拟写 handler。此复现仅访问本任务随机回环端口，无业务数据库、线上账号或真实写入。

生产及管理员会话集成现在共用 `registerAdminCsrfProtection`，根据路由器已匹配的 `request.routeOptions.url` 判断管理路径，登录豁免仅精确匹配 challenge/verify。未匹配的路由不能进入管理 handler；读请求及公开路由保持既有语义。

`pnpm test:http-security` 已纳入 `pnpm check`，使用实际 Fastify、Cookie 和 CSRF 插件以及原始 TCP 请求，覆盖四类写方法、绝对/普通形式、查询参数、错误和正确令牌、相似登录前缀拒绝、编码/未匹配路径。该运行方式避免 Jest VM 对 Cookie 依赖动态 import 的限制，不以 mock 替换真实插件。

其他定向回归覆盖 Nest 路径中间件、非法 URL fallback、false/header schema、实际 TLS SMTP、文件/URL 读取限制、JSON 预览、导出与静态目录穿越。解析恶意样本仅在清空业务环境的独立 Node 子进程运行，128 MiB 堆、5 秒超时及 SIGKILL 回收。

## 检查记录

定向阶段：生产安全审计与 RawUnsafe 检查通过；5 组 Jest 定向测试 30 项、真实 HTTP/解析/静态回归 8 项通过。治理任务进行了独立只读代码复核，无阻断问题。

完整 `pnpm check:full` 退出码 0：

- 生产依赖审计全部严重级别为 0，RawUnsafe 检查通过。
- lint、typecheck、架构、OpenAPI、文档及契约校验全部通过，OpenAPI 233 个操作保持不变。
- Jest 185 组／2,456 项通过；真实 HTTP/解析/静态回归 8 项通过，无跳过。
- 预览、清理单元、富文本、移动发布、运行健康、发布源、API/Worker 启动、数据安全脚本全部通过。
- `pnpm check` 的常规 `nest build` 成功；之后没有再次修改运行源码或重复构建。
- 真实 PostgreSQL/Redis 清理事务集成通过；生命周期覆盖并发、异常、遗留后代、SIGTERM/SIGINT、SIGKILL 定向回收，全部通过。
- 全量 HTTP/集成 17 组通过：基础 API、拉黑搜索、主楼策略、私帖邀请、关注计数、编辑时间、图集、移动发布、认证、经济、媒体回收、排行、管理控制台、管理员会话、媒体展示、收藏管理、收藏可见计数。

### 隔离资源与清理

官方一次性 runner 使用以下只读二进制配置，未继承任何线上数据库或 SMTP 凭据：

```bash
E2E_PG_BIN=/opt/wenyousite/e2e-tools/usr/lib/postgresql/16/bin
E2E_REDIS_BIN=/opt/wenyousite/e2e-tools/usr/bin/redis-server
E2E_LIBRARY_PATH=/opt/wenyousite/e2e-tools/usr/lib/x86_64-linux-gnu
pnpm check:full
```

HTTP 全量运行 `e2e_d91ea8c44376740dc30cfbd0` 的身份：

- 根目录 `/tmp/wenyousite-e2e-Nc8zOF`，所有者 UID 1002，0700；manifest 为 0600。
- API 为 `127.0.0.1:40425`；PostgreSQL 为 `127.0.0.1:35533`，随机数据库 `wenyousite_e2e_d91ea8c44376740dc30cfbd0`，clusterName 与 runId 相等。
- Redis 为 `127.0.0.1:35079`，instanceId `693f965acef8d440783f53ea0c10681621b00e5d`；上传目录属于本轮根目录。
- runner 在迁移和每组写入前核验实际 PostgreSQL cluster_name、Redis instanceId/ownership；邮件 JSON transport、真实推送、Sentry 和外部存储写入保持隔离配置。
- 结束输出 `resourcesCleaned=true`；另行核验根目录已删除、该 Worktree 登记目录为空、API/PG/Redis 三个端口均关闭。

### 可复核摘要

运行源码、测试、脚本、契约和构建配置共 845 文件的有序 SHA-256 清单摘要为 `5482d1c69c5786c49c6395ae42a02e8682b01d7743b37d3053b4cfff31fdfbb1`；完整检查后逐项重算一致。精确提交 SHA 以同批 PR 为准，提交前仅追加文档证据并删除 `scripts/admin-csrf.test.ts` 末尾多余空行；8 项真实 HTTP/解析回归再次通过。最终文件清单摘要为 `2441399e63e10a747667132fa65d5d7413858b6be20dc7c6fb348b69817a9cfd`。

- 完整检查日志：`/tmp/backend-dependency-security-check-full.log`；SHA-256 `4b6af9b5ffdf35aef5b744b45f73cf1cb54356f909ff30d55ae26e6b2dc96dea`。
- 常规构建 `dist/main.js`：SHA-256 `74515bc8cb31d81a5c96be2fb3609d214ea1ae2eda1041959fb4c298e9263bf1`。
- 生产审计 JSON：`/tmp/backend-dependency-security-audit-final.json`；SHA-256 `cf5fcdea8d8bd7233bfa9434f9785a81c281d39cae3c3298a5820c9db02f0436`。


## 边界

不修改 OpenAPI、Markdown 协议、数据库结构或迁移；不启用 HTTP/2 或 gRPC 服务端。全部写入使用仓库官方一次性隔离入口，公网仅允许只读验收。合并及管理身份部署由治理任务按用户已给授权处理。

Auto-review 默认偏好已传递；当前协作工具没有受支持的配置及启动日志核验入口，实际审批配置未设置／未核验。本会话 `never` 不代表 Auto-review。
