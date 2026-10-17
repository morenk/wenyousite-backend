# 文本颜色与安全空段写入兼容修复验收

## 范围与根因

本轮沿用 PR #54、分支 `codex/20261017-text-color-alignment-compat` 和原 Worktree，基线为 `7f95563edd8f461ebb7a66d7b458ec0349e39297`。原旧端去色/对齐修复继续保留。

用户报告的编辑发布诊断为 HTTP 400 / `INVALID_TEXT_COLOR (40018)`，已只读匹配同 requestId 的服务端异常日志。日志不记录正文；从当前本机草稿取得的 56 字符复现输入是安全空段紧邻彩色 H2。旧颜色解析使用普通 Markdown 块解析，将独占 `<br />` 与其后彩色标题一起视为 `html_block`，严格校验因此拒绝。原发布态的连续彩色 H3/H2 两段离线通过，未丢失正文。

颜色解析现复用正文已有的受控空段/对齐块边界。边界解析器在真实 inline token 上附源码偏移，合并现有 meta；直接使用完整块 children 保留引用链接定义上下文、token.level、代码与转义语义。任意 HTML/属性、跨行颜色、外层样式包裹颜色、图片/骰子/提及等原子仍拒绝。

新增 8 个共享 fixture 覆盖空段紧邻 H2/H3、无序/有序列表、引用、引用内空段、居中、靠右标题。未改 DTO、能力、OpenAPI、Markdown 版本或 Foundation 常量；不需要 Foundation 发版。App 本机草稿自动继承行为不在后端修复范围。

## 检查

- 先增加失败回归：旧实现 12 fail / 145 pass，日志 `/tmp/text-color-empty-row-before.log`。
- 最终定向检查：颜色、块边界与正文 3 suites / 591 tests 全通过。覆盖空段/排版/格式、中文/emoji/组合字符、重复文本的绝对偏移、引用定义前后、普通 URL、负面 HTML 与原子边界。
- 最终 `pnpm check:full` 单入口退出 0：安全审计无已知漏洞，lint/typecheck/架构/OpenAPI/脚本/文档/构建通过；Jest 208 suites / 2857 tests；完整 E2E 26 套件；音频预算 12 场景。
- 独立 `pnpm e2e:run --suite=text-color` 关闭新写回归退出 0。真实 PATCH 验证空段彩色 H2 楼层及草稿保源、能力读取、旧端去色/覆盖拒绝、恶意 HTML 拒绝；开启和关闭分支均执行。
- 首次完整入口停在安全审计：registry ECONNRESET 重试后退出 1，没有跳过检查；重跑仅移除该子进程代理环境，全局配置未改。最终应用源码与完整门禁一致，之后只补本文档并执行文档/差异检查。

## 资源与清理

所有写入只在本轮 runner 创建并核验的独立 PostgreSQL、Redis、上传目录和随机账号执行。UID 1002；PG cluster_name / Redis 身份及归属经 runner 验证。真实邮件、推送、外部对象存储写入关闭。完整 E2E API 为 `http://127.0.0.1:33673`；关闭新写为 `http://127.0.0.1:46387`，两轮不共享数据资源。

| runId | PG / Redis 端口 | Redis 实例 | 资源根目录 | 清理结果 |
| --- | --- | --- | --- | --- |
| e2e_db300a861d3bd0c2b138cd4f | 35683 / 42565 | 66db01dca75f30263004dc8a39f1581a7d5acb48 | /tmp/wenyousite-e2e-Xd8T3x | 已清理，路径不存在 |
| e2e_65b8b08be986675b78e5dbf5 | 40633 / 39135 | 6831d702b2dd5947e8b9fd0408e7b6f94a0eee14 | /tmp/wenyousite-e2e-MsGxo5 | 已清理，路径不存在 |
| e2e_9a63a7adac5503119c5303ad | 39697 / 45351 | 85dd352d1b48dd26f3826c757b46d03dd56e04a2 | /tmp/wenyousite-e2e-RVop69 | 已清理，路径不存在 |
| e2e_47b2545673bed93249a8befb | 40713 / 39731 | 463b40bc99fc04437ef0aeb11e175eda1b0afa99 | /tmp/wenyousite-e2e-Eq1ROR | 已清理，路径不存在 |
| e2e_7decae333f9476f28637b032 | 44915 / 36803 | 34a54e2601f4de94ba2a5ae6b3c48653dc8bbc29 | /tmp/wenyousite-e2e-99LY1h | 已清理，路径不存在 |
| e2e_b20158c420ac615d0d6abf39 | 33153 / 44461 | 5046ff2895d0d2b751381fe0461d8f289984c4f8 | /tmp/wenyousite-e2e-0hskl4 | 已清理，路径不存在 |
| e2e_8135ce4686bfd63e93285f62 | 40731 / 38883 | 76e894cffba37fe57e052c5d88167d2711aeb97a | /tmp/wenyousite-e2e-4LF3rg | 已清理，路径不存在 |
| e2e_22b78509e3dcfe88cfe8f2b4 | 44969 / 42067 | b0dacc333a7890a3c1dd45cf8f16282b506eee8e | /tmp/wenyousite-e2e-0KunH2 | 已清理，路径不存在 |

本轮 8 组均有 resources-verified / resources-cleaned，resourcesVerified=true、resourcesCleaned=true；交付前逐项检查根目录全部不存在。完整证据为 `/tmp/text-color-empty-row-resource-evidence.json`。

## 发布边界

本轮没有合并、部署、重启服务或修改线上开关。目标 dev 基线较已部署 `d3577839dc537e21c546ee385a4c97091b58a8f7` 另含已合并音频 PR #53（契约 5.39.0-dev.20261017.1）：活动上传与每日输入预算、42901/42902、只读审计、迁移 `20261017010000_audio_resource_budget`。迁移新增 media 音频输入/租约字段和索引，并回填在途上传输入大小。最终部署必须明确包含这批变化，不是仅切换颜色代码。

默认 Auto-review 偏好已传递；实际审批策略为 never，宿主没有设置 Auto-review 的入口，未宣称已启用。App/Web 消费者往返及负责人真机验收由治理继续记录。

## SHA-256

- `/tmp/text-color-empty-row-check-full.log`：`589557077d715a33efb5fa6fa918dc669ba7cd839a0759729c988b5142506a80`
- `/tmp/text-color-empty-row-check-full-direct.log`：`3c1b2ea1b0165ce733cdcbdf2a97dda775c7090837260d64780ff7dcae1fc873`
- `/tmp/text-color-empty-row-closed-e2e.log`：`b805d594a60e3332157794582be6e23a12fe0b0596e3f1a31c7628922071d32d`
- `/tmp/text-color-empty-row-targeted.log`：`dd9816ec8d267406ac88c83d3e3e6696521a6ccc80d7a277ad26d1d34a185fab`
- `/tmp/text-color-empty-row-resource-evidence.json`：`2e03df5c20beb3d2f233f788d50ca275400510b192737bef989d4a3bf895cf62`
- `/srv/wenyousite/.worktrees/backend-text-color-alignment-compat/src/common/text-colors.ts`：`8d9799aa6778a11fe6e1a97075ac2028682644f530a01d809fa4728c5a88ac74`
- `/srv/wenyousite/.worktrees/backend-text-color-alignment-compat/src/common/markdown-block-boundaries.ts`：`eefd0ffbf916fb6e5b200e60e5e3e09d707d76ebb1c7c93a9be92ae02673baa9`
- `/srv/wenyousite/.worktrees/backend-text-color-alignment-compat/contracts/markdown-text-color-v1-fixtures.json`：`b1a7a5ab4814bf2e93e5032bceeeefd84fbab9b6e647dec60c325b459c005a2e`
