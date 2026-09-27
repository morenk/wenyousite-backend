# Android 版本说明后端验收记录

本记录对应 `codex/20260927-mobile-release-notes` / PR #32，验收日期为北京时间 2026-09-27。负责人随后明确授权合并与部署；本文记录合并前验证，不代表已部署、真实 APK 晋级或负责人视觉验收通过。本开发任务没有 sudo、重启正式服务或线上写入。

## 交接版本

- API 契约提交：`99b42dc0f7d25eeb6e49ee87441e206c77cce29a`，OpenAPI `5.27.0-dev.20260927.1`。
- 受限 CLI 与管理隔离账号：`9946b56147f3809bc4de03fcd8f421e7330a971a`。
- 合成预览入口：`77eb8324188cc0443407f13c27bc6bf355d7708a`。
- Windows 运维指导及已发布测试种子：`72d3658d32a089fcfabdea30225d87b960033c5b`。

Windows 安装器、DPAPI、SSH 指纹、分段发布与密钥轮换说明从 Mobile 已提交 `b91a27da` 的参考文档核对并保留到后端事实源。VPS 上 Mobile 镜像仅执行 fetch/show，没有实施修改。

## 自动化证据

- `pnpm check:full` 通过，包含 `pnpm check`。182 个 Jest 套件、2439 项测试通过；生产依赖安全审计无已知漏洞；OpenAPI、文档、架构、类型、lint、构建及原有运维检查通过。
- 完整隔离 E2E：`e2e_c50f9a28ac978275a917fc20`；HTTP 主链、图片图集、移动说明、认证、经济、媒体、排行、管理、管理会话、展示、收藏均通过。结束输出 `resourcesCleaned=true`。
- 管理账号与发布种子真实 HTTP 联验：`e2e_c0ddfc0dab3baf74de464fab`，随机 ADMIN/SUPER_ADMIN 经正常邮件验证码登录，实际 Cookie/CSRF 生效；管理员修正已发布文案被拒绝，超级管理员确认前保留旧文、确认后替换。结束输出 `resourcesCleaned=true`。
- 定向数据库/CLI 联验：`e2e_9f431d6119440ecb840e9ba8` 通过并清理。最终全量还覆盖迁移前植入的账号、内容、钱包、审计在增量迁移及重复 migrate deploy 后逐行不变，及真实受限 shell + 编译后数据库 CLI 的失败补偿和同 build 幂等。
- shell 故障测试 13 项通过：确认记录、对象身份、降 build、TSV/数据库/策略/公开读回失败，PREPARED/STAGED/COMMITTED 的 SIGKILL，数据库临时不可读时先恢复策略并保留锁，受限 `--recover` 后可重试。
- 全量门禁后的小修正仅调整“说明领取失败、尚未写策略时不重启服务”；重新运行 13 项 shell 测试及移动说明真实隔离集成。没有放宽断言或跳过用例。
- 最终部署复核发现 root 门禁与 shell 测试非特权约束冲突，已让测试在创建样本前清空补充组、永久降为 `nobody`，只执行私有临时目录中的源码副本，子进程不继承部署环境。普通开发身份下 13 项故障测试通过。
- 治理经 `wenyou-admin-vps` 以 root 启动同一 `node --test scripts/mobile-release.test.cjs`，13/13 通过、0 失败/跳过，耗时 33.18 秒。执行前后测试文件 SHA-256 均为 `4536c83361ad34e591fc0537db3c3c39080793e2c109dfae8f25853a608f99cc`。该次仅运行降权测试，没有调用正式晋级或改写生产环境；原始日志由治理保存在 Windows 的 `artifacts/mobile-release-notes-20260927/backend-root-release-tests.log`。
- 合并前最终 `pnpm check` 全部通过，包含 182 个 Jest 套件/2439 项测试、13 项 shell 故障测试及类型、架构、OpenAPI、文档、运维脚本和构建检查。日志为本任务 `/tmp/mobile-release-check-merge.log`，定向 shell 日志为 `/tmp/mobile-release-shell-root-gate-fix.log`；实际迁移/CLI 最后定向 runId 为 `e2e_a51e21e5bb0ab30313abfd57`，通过并清理。

隔离测试使用本轮新建 PostgreSQL/Redis，应用角色为 `wenyousite_app`，外部邮件、推送、Sentry 和存储写入关闭。APK 公网对象、systemctl 和重启后的策略读回由本地测试替身提供，真实 DB 事务和 HTTP 权限不模拟；这些证据不代表已测试真实发包。

原始无凭据入口日志位于本任务 `/tmp/mobile-release-check-full.log`、`/tmp/mobile-release-shell-final.log`、`/tmp/mobile-release-integration-delivery.log`、`/tmp/mobile-release-admin-fixtures-final.log`。不提交私有账号、会话、收件箱或数据库连接信息。

## 共享预览

当前真实快照缺少北京时间 2026-09-27 批次，因此使用明确标注的合成数据。已提交入口创建并验证以下独立预览：

- session：`mobile-release-notes`；runId：`preview_705231a26b764b7cd53eed8e`。
- API：`http://127.0.0.1:35293`；媒体：`http://127.0.0.1:36911`；Web 端口：`38751`。
- 消费者文件：`/home/wenyou-dev/.local/state/wenyousite-preview/mobile-release-notes/consumer.json`。
- 后端运行源码 SHA：`77eb8324188cc0443407f13c27bc6bf355d7708a`；摘要：`bfdd4c9acb3554611b198c04a902581f38419d6913ebea22b733263e2abd135d`；启动时 sourceDirty=false。

backend/media 两个 identity 端点已核验，PG/Redis、上传、本地 S3、图片 Worker、邮箱和会话均为本批次独立资源。随机账号仅存在同批次私有 `sample-accounts.json`，消费者先验证描述和实际身份再登录。该预览保留给 Web/Mobile 联调；没有删除或接管其他批次。Web/Android 的实际明暗窄屏画面与负责人验收由消费者任务交付，本记录不冒称视觉验收通过。样本不改变 `/meta` 的升级策略，也没有真实 APK 下载验收。

## 权限核验

最初实际 turn_context 为 `approval_policy=on-request`、`approvals_reviewer=user`，不是 Auto-review。负责人随后明确切换完全访问；本聊天实际日志为 `approval_policy=never`、`sandbox_policy=danger-full-access`，reviewer 字段仍为 user。这不扩大原有合并、部署、晋级边界；本任务没有再分派子任务。
