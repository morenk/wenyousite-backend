# 文本颜色 v1 Backend 验收记录

## 实现与交接版本

- 工作树：`/srv/wenyousite/.worktrees/backend-text-color-v1`；任务分支：`codex/20261016-text-color-v1`；基线：`origin/dev` 的 `1aa8655f7c8e25dcc8723d7793afb9cefc6d510d`。
- 实现、OpenAPI 与隔离入口提交：`2cdedbcdecee4991634cf4b256aa0f547b06d88c`；API 合约版本 `5.38.0-dev.20261016.1`。后续本记录提交只增加交付证据。
- 文本颜色语法/共享 fixture 来源：`7f58f9c15269663a9e615493c82e2084afd300c8`。Foundation 7.4.0 固定该历史来源。实现提交补齐 clipboard fixture 的既有 `plainText`/`expectedText` 字段，消费者同步实现提交；不移动 Foundation Tag，不改共享语义。
- `TEXT_COLOR_V1_ENABLED` 默认 false；无数据库迁移。全局 Markdown 5 与角色提及 6 独立保留。此记录没有合并、发布、部署或服务重启授权。

## 检查结果

- `pnpm check` 完整通过：207 个 Jest suites / 2780 tests，及 lint、TypeScript、架构、OpenAPI、脚本测试、文档、构建。日志 `/tmp/backend-text-color-check-final.log`。
- 此轮末尾补齐 TXT 导出数字实体与路由边界，随后重新通过 `pnpm lint`、`pnpm typecheck`、`pnpm build`、颜色 121 项与导出 18 项定向测试；动态及动态搜索保留字面 span，用户最近回复的原正文参与能力投影。
- `pnpm check:full` 首次在 `security:audit` 遇到 npm registry ECONNRESET，未进入后续阶段。仅单次移除进程代理环境重试 `pnpm security:audit`，通过且无已知漏洞；没有关闭 TLS 或更改 registry。随后逐项完成 `check:full` 的全部阶段：`pnpm check`、`pnpm test:cleanup:integration`、`pnpm test:e2e:lifecycle`、`pnpm test:e2e:full`。本记录采用等价完整验证，不声称最初单条命令成功。
- 全量隔离 E2E 完成 26 个脚本套件，包括音频、角色提及、身份、讨论定位、Redis 失败、内容并发一致性、管理、媒体与书签。API 启动后补充的最终路由/TXT 修改另以最终构建完成颜色启用/关闭两轮 HTTP E2E（见 `final-*`），完整 E2E 不冒称覆盖启动后修改。
- 关闭新写与启用新写均验证旧端去色读、交替能力读/cache、旧端删除全部颜色的覆盖拒绝、草稿/槽位、BODY、聚合、楼层/回复/主题/子帖创建、非法属性与内存 ZIP 导出。
- Web 实际 Milkdown no-op 候选 21 条通过关闭新写的语义门禁；治理任务独立比较 2775 种左右格式组合，报告 0 个语义差异。以上为补充证据，不替代正式检查。

## 本轮隔离资源与清理

所有写入仅在 runner 核验后的独立资源执行：UID `1002`；PostgreSQL `cluster_name` 等于 runId；Redis 同时核验实例 run_id 与归属键；上传目录为下表根目录的 `/uploads`。邮件、推送、外部对象存储写入被隔离入口关闭。真实环境没有自动化业务写入。

| 运行 | runId | PostgreSQL / Redis 端口 | Redis 实例 | 独立根目录 | 清理结果 |
| --- | --- | --- | --- | --- | --- |
| `cleanup-check` | `e2e_5532b8e06f6c54528172fb6b` | `34919` / `35781` | `f3fcb388b920878db41f59b39fdf30e0526a64ee` | `/tmp/wenyousite-e2e-wI3pOy` | 已核验并清理；根路径复核不存在 |
| `lifecycle` | `e2e_3b18a053ea73d131c425a2a4` | `42135` / `38957` | `e1f74fd6a4e23b76b7fcc2e03eed669f6f682742` | `/tmp/wenyousite-e2e-ffchJq` | 已核验并清理；根路径复核不存在 |
| `lifecycle` | `e2e_c4cdf5bf4a94329bbfefc281` | `33227` / `46021` | `08d12a83e048d7b4d392a1dd2ac0457e27a14a8f` | `/tmp/wenyousite-e2e-rzo6MX` | 已核验并清理；根路径复核不存在 |
| `lifecycle` | `e2e_1f3564f9da4ff08418dad005` | `34063` / `40363` | `a86ca552f75e1a8433449d712fffd978a23e31a4` | `/tmp/wenyousite-e2e-nW2CXO` | 已核验并清理；根路径复核不存在 |
| `lifecycle` | `e2e_f81a86f9badd8c85ce62bb4a` | `46601` / `45291` | `3fa7c3a4f11ce519fbbea077a83b27b88b8c0a7c` | `/tmp/wenyousite-e2e-VRR9x1` | 已核验并清理；根路径复核不存在 |
| `e2e-closed` | `e2e_c8df566fd79d728cc894d098` | `44693` / `38197` | `bdda01f14f1770aa7707e5e07cb27b92f21fa551` | `/tmp/wenyousite-e2e-0VBngl` | 已核验并清理；根路径复核不存在 |
| `e2e-enabled` | `e2e_5a73d258c37a3fd743c8a028` | `37227` / `32921` | `47c9b08c29bc591633199827b796c84e67b625f5` | `/tmp/wenyousite-e2e-9NAb3K` | 已核验并清理；根路径复核不存在 |
| `e2e-full` | `e2e_c40b127e6c2692bd3321510b` | `44979` / `33043` | `310a91271428ac50192f978f0a235f53da6e50f4` | `/tmp/wenyousite-e2e-ZwBBO7` | 已核验并清理；根路径复核不存在 |
| `final-closed` | `e2e_b5827519b506d757da878e11` | `33293` / `35021` | `3ee474b6aba615fd4bc9f66ae88d37518a7a1563` | `/tmp/wenyousite-e2e-fUuK7X` | 已核验并清理；根路径复核不存在 |
| `final-enabled` | `e2e_8977be04201edb2157d2adf1` | `33169` / `41615` | `6c9df3ba34e4d70cf7bba1bf5287683cd719624e` | `/tmp/wenyousite-e2e-YeKYeZ` | 已核验并清理；根路径复核不存在 |

根目录删除复核在最终两轮结束后执行；各日志均有 `resourcesVerified=true` 和 `resourcesCleaned=true`。生命周期验证包含两轮并发、异常、遗留后代、SIGTERM/SIGINT、SIGKILL 残留识别与定向恢复；没有清空共享数据源。

日志均为本任务命名的 `/tmp/backend-text-color-<运行>.log`。早期开发失败记录未完整留存，不能回溯所有早期 runId/端口，不以其它任务的临时失败日志填补。已知早期问题包括未准备本机音频测试运行资产、Vary 断言需要新增能力头、合约版本元数据未同步；均已修复并重跑。上表仅列有身份和清理双重证据的运行；正式最终完整运行与最终两轮的成功及清理证据独立成立。

## 待验收与发布边界

- 本任务只交付 Backend；App 真机、取色盘视觉与 Web 实际编辑验收由对应消费者任务记录。
- 生效顺序：兼容后端 → 保源消费者 → 明确开启新写；需要各仓库负责人批准，不在此任务自动执行。
- 默认 Auto-review 偏好已传递；实际运行配置为 `approval_policy=never`，宿主未提供可配置 Auto-review 的入口，不能宣称自动审查已设置。
