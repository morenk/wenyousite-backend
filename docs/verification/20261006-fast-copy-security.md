# RP 发布依赖门禁：fast-copy 安全补丁

## 触发与范围

RP 资料后端 PR45 已合并到 `dev`，合并提交 `eb9ff12c770b14501eb1d9daa19f4d823728eba6`；管理入口部署在安全审计阶段停止，尚未备份、迁移或切换。本补丁从该合并提交建立，单独交付 PR，合并及继续部署等待负责人明确决定。

首轮日志 `/var/log/wenyousite/rp-profile-backend-eb9ff12-20261006.log` 记录现有出站代理导致的 npm TLS 失败；第二轮仅对本次进程的 `NO_PROXY/no_proxy` 追加官方 `registry.npmjs.org`，日志 `/var/log/wenyousite/rp-profile-backend-eb9ff12-20261006-retry1.log` 记录实际依赖漏洞。未关闭 TLS 校验，未改审计服务、阈值或部署入口。

官方依据为 [fast-copy GHSA-jggr-w7fw-pc2j](https://github.com/planttheidea/fast-copy/security/advisories/GHSA-jggr-w7fw-pc2j)。深层嵌套对象的递归拷贝可能耗尽调用栈；本项目实际链路为 `pino-pretty -> fast-copy@4.0.4`，修复版本为 `4.1.0`。本轮 npm 审计标记 moderate，上游原公告标记 low；如实保留差异，不据此放宽门禁，也不把本轮发现称为新披露。

`pnpm-workspace.yaml` 对受影响的确切版本增加 override，锁文件仅替换 fast-copy 版本、integrity 及该依赖边；不升级其他包，不改业务源码、运行配置、数据库迁移或共享协议。`scripts/dependency-parsers.test.ts` 通过实际 pino-pretty 依赖解析，在限时、限内存、不带业务凭据的子进程验证深 5000 层对象被受控 `MaxDepthExceededError` 拒绝，以及正常对象、循环引用复制仍正确。

## 验证与发布边界

- 定向 HTTP 安全回归：10 项通过。
- `pnpm check:full` 中生产审计为零漏洞，完整 `pnpm check` 通过：195 套 / 2523 项 Jest、HTTP 安全、预览、清理工具、富文本、下载/发布/数据安全、文档、OpenAPI、构建全部通过。随后因新 Worktree 未配置只读 E2E 二进制路径，在资源注册和创建前停止，原退出码 1 保留，日志 `/tmp/rp-release-fast-copy-check-full.log`。
- 补充 `E2E_PG_BIN=/opt/wenyousite/e2e-tools/usr/lib/postgresql/16/bin`、`E2E_REDIS_BIN=/opt/wenyousite/e2e-tools/usr/bin/redis-server` 和只读库目录后，顺序补跑 `test:cleanup:integration`、`test:e2e:lifecycle`、`test:e2e:full` 全部退出 0，日志 `/tmp/rp-release-fast-copy-isolated.log`。已通过阶段未重复执行，合并证据覆盖完整门禁；不将首轮失败写作一次全绿。
- 22 条隔离业务旅程通过，包括资料楼层、平级角色提及、历史身份和拒绝路径；`runId=e2e_69ac7a7890d5888c1e658e4f`、`resourcesCleaned=true`，原目录 `/tmp/wenyousite-e2e-LtEZzm` 已移除，当前 Worktree 登记为空。
- `git diff --exit-code origin/dev -- contracts` 通过，HTTP/OpenAPI 与 Markdown 机器契约无漂移。
- 本补丁没有线上业务写入；角色提及写开关保持 false。授权继续发布时仍使用完整管理部署入口，不能用手工服务切换绕过门禁。

验证日志 SHA-256：

- `rp-release-fast-copy-check-full.log`：`905545d2d409d162564aaeaffc25e093d5e293ad22d008d160e28a20455eb94a`。
- `rp-release-fast-copy-isolated.log`：`5888e3cbf925750028d14ea931410d2bd13eba8cc8a466e41706dbbf5300c0e6`。

OpenAPI SHA-256 保持 `a3a572443cebb7254770ec8d5c33ca07089dfd78fce1553804c6a5234a7f78fe`，API 仍为 `5.36.0-dev.20261005.1`。验收源只改依赖与回归；之后仅补充本记录并整理一处测试空白，定向 HTTP 安全 10 项再次通过。
