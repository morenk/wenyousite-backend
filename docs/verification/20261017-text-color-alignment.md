# 文本颜色与段落对齐兼容修复验收

## 版本与修复范围

- Worktree：`/srv/wenyousite/.worktrees/backend-text-color-alignment-compat`；任务分支：`codex/20261017-text-color-alignment-compat`。
- 更新后的集成基线：`7f95563edd8f461ebb7a66d7b458ec0349e39297`。离线发现问题的已部署实现为 `d3577839dc537e21c546ee385a4c97091b58a8f7`，两版本的颜色与块边界实现相同。基线中的音频提交未由本任务修改。
- 唯一生产代码变更：`stripTextColors` 复用已有 `analyzeMarkdownBlockBoundaries`，按真实段落边界重序列化颜色范围。最终实现文件 SHA-256：`2adc6fd891fe5f2ba55f93ef4d020ae06bc266052c9095f150d894d7f2c47e68`；本记录与实现同一提交交付。
- API 范围复核：媒体展示拦截器的受限正文路由投影、主题档案导出、`truncateMarkdown` 的搜索/通知等摘要均复用本函数；不扩大动态/私信路由范围。写入校验、颜色关闭门禁、DTO/header/meta、OpenAPI 和数据库均不变。
- 新增 4 个首段／紧邻前段的 center/right 共享 fixture；span 语法和能力协议不变。消费者可同步新增语料回归，不需要 Foundation 新发版，也不移动已发布的 7.4.0 历史来源。

## 问题与定向证据

合法正文中的对齐标记可紧接上一段而不插空行：

```markdown
前段
[wenyousite-align-v1-center]: #
<span data-wenyou-color-v1="#D14343">如何呢</span>
```

旧实现用普通 Markdown 块解析，去色时将协议标记一并转义为字面文字，导致旧端失去居中／右对齐。修复后仅移除 span，保留对齐协议、段落和其他内联格式。首段直接带颜色的原始真机样本原本已被后端接受；本修复处理进一步组合复核发现的相邻段落问题，不能代替 Mobile 编解码修复。

- 先加回归再改实现：`pnpm exec jest src/common/text-colors.spec.ts --runInBand` 精确出现 5 项失败、127 项通过。日志 `/tmp/backend-color-alignment-before.log`。
- 修复后颜色、块边界、摘要、档案导出共 4 个 suites / 388 tests 通过，覆盖 center/right × P/H2/H3 × 32 种粗体、斜体、删除线、普通链接、行内代码组合，中文、emoji、组合字符，以及连续不同对齐段落。日志 `/tmp/backend-color-alignment-after.log`。
- 补充离线矩阵 1541/1541 通过：3 种块 × 3 种对齐 × 32 种格式 × 4 类文本，另含相邻段落／格式边界及多段样本。验证规范化、关闭写时保源、旧端覆盖拒绝、去色后的块边界与语义。修复前同类矩阵有 64 个相邻 P 段落失败。
- 离线报告 `/tmp/backend-color-alignment-after-matrix.json`，SHA-256 `224bd9f397484a1501b5464ac76d453b503b3f97ae71169ad4bdd49b485f5eb9`；发现报告 `/tmp/backend-text-color-alignment-review-20261017.json`，SHA-256 `12d282a3a9861ceeb67d71092cffe43a18f735f491ab4a168c35d48c1e8a013c`。矩阵是补充证据，正式回归保存在仓库测试与 fixtures。

## 完整门禁

`pnpm check:full` 单条入口退出码为 0；安全审计无已知漏洞，lint、类型、架构、OpenAPI、脚本、文档、构建、清理集成、生命周期、完整 E2E、音频预算集成全部通过。Jest 共 208 suites / 2804 tests；完整 E2E 为 26 个套件；音频预算为既有 12 个集成场景。本任务未跳过检查或扩大警告基线。

执行时仅移除本进程代理环境，未改变全局 registry 或 TLS；隔离二进制配置为 `E2E_PG_BIN=/opt/wenyousite/e2e-tools/usr/lib/postgresql/16/bin`、`E2E_REDIS_BIN=/opt/wenyousite/e2e-tools/usr/bin/redis-server`、`E2E_LIBRARY_PATH=/opt/wenyousite/e2e-tools/usr/lib/x86_64-linux-gnu`。日志 `/tmp/backend-color-alignment-check-full.log`，SHA-256 `a26e314a71292f26494ff307ebceec3ba99b9707432b08de528aefa94bd13647`。最终生产源码与此轮检查相同，之后仅补验收记录并执行文档检查。

新增 fixture 文件 SHA-256：`2300b00fc90d8d3996275470cd877b97a4c40a41a802595edb4e2bff11c38c87`。治理任务已只读复核最小生产差异、回归测试和 HTTP 路径；消费者当前仍可锁定实际上线 API 来源，此修复不要求提前改版本。

## 隔离写入与清理

所有 HTTP 写入只在本轮 runner 核验的独立 PostgreSQL / Redis / 上传目录与随机账号中执行。UID 为 `1002`；PostgreSQL `cluster_name` 等于 runId，Redis 实例和归属键一并核验；上传路径为独立根目录下的 `/uploads`。入口关闭真实邮件、推送和外部对象存储写入，未调用真实环境业务写接口。

首次关闭颜色新写的回归因新增测试错误要求 ZIP 保留对齐而失败。既有 `renderExportContent` 本来主动移除对齐并附警告；测试已修正为检查无原始或转义的协议泄漏、正文和颜色能力正确。未修改档案导出产品行为，首次资源已完成清理。修正后的关闭新写回归通过。

| 运行 | runId | PostgreSQL / Redis 端口 | Redis 实例 | 独立根目录 | 清理结果 |
| --- | --- | --- | --- | --- | --- |
| 关闭新写首次断言失败 | `e2e_b6d2aebba4795d366d870b08` | `42517` / `45765` | `869da671ce5d79d0fcb86f31385e68be105cee0c` | `/tmp/wenyousite-e2e-e6ke24` | 已核验并清理，路径复核不存在 |
| 关闭新写修正后通过 | `e2e_13cb6fd7c99cb68683482cbd` | `35275` / `36429` | `a1ace9717b3407ee5d73dbf21b46db403820c655` | `/tmp/wenyousite-e2e-BGxXmy` | 已核验并清理，路径复核不存在 |
| 清理集成 | `e2e_a85f64491404884427a1c8bb` | `39651` / `36601` | `b14bbe240fb1c38066d304608a4494ac7ab317a2` | `/tmp/wenyousite-e2e-iHmgb8` | 已核验并清理，路径复核不存在 |
| 生命周期 | `e2e_673023b5a19df3a8d330620e` | `32923` / `45261` | `33d00f69a8eefe8e3a99283b9b13cab7d97219bf` | `/tmp/wenyousite-e2e-LVDkCk` | 已核验并清理，路径复核不存在 |
| 生命周期 | `e2e_7365c067618a120854e04eb1` | `33355` / `41815` | `9225253d7573b25822e4546cca8a8606f5275efa` | `/tmp/wenyousite-e2e-WtqVJe` | 已核验并清理，路径复核不存在 |
| 生命周期 | `e2e_6891e29d6bbb076c6c451382` | `39089` / `45213` | `4d00b7f6a0eaca037b540136cdfc3e2ab8ababed` | `/tmp/wenyousite-e2e-87Y6gN` | 已核验并清理，路径复核不存在 |
| 生命周期 | `e2e_f3356b3c30c0b47d1961cee9` | `44231` / `44043` | `5c8e73c47f55457fa736e029df01345529f29d3a` | `/tmp/wenyousite-e2e-FgZquY` | 已核验并清理，路径复核不存在 |
| 完整 E2E | `e2e_479d21129bb58cb33329f830` | `45807` / `34713` | `2bd37daa0a7b0a32e46e204ed17ed2de08ad53fd` | `/tmp/wenyousite-e2e-NtJHeU` | 已核验并清理，路径复核不存在 |
| 音频预算集成 | `e2e_88b40a5775d624487ba5728c` | `35923` / `35947` | `411274a8597ca982e166d803ea66d53b924b9e45` | `/tmp/wenyousite-e2e-3p4Q7N` | 已核验并清理，路径复核不存在 |

上表 9 轮均有 `resources-verified` 与 `resources-cleaned`，且 `resourcesVerified=true`、`resourcesCleaned=true`；最终逐项复核根目录全部不存在。完整 E2E 的 API 地址为 `http://127.0.0.1:41131`，关闭新写成功重跑为 `http://127.0.0.1:36913`。生命周期覆盖并发、异常、遗留后代、SIGTERM/SIGINT 和 SIGKILL 定向恢复。

首次失败及成功重跑的日志分别为 `/tmp/backend-color-alignment-closed-e2e.log`、`/tmp/backend-color-alignment-closed-e2e-retry.log`；所有清理证据摘录保存在 `/tmp/backend-color-alignment-resource-evidence.json`。首次失败的私有原始诊断文件已在诊断结束后核验归属并删除，只保留无凭据的结构化失败和清理记录。


## 边界与待验收

此轮没有合并、部署、重启服务或修改线上颜色开关。App 的取色、返回输入及真实排版画面由 Mobile／治理任务继续验收；后端离线和 HTTP 结果不冒充真机视觉验收。默认 Auto-review 偏好已传递；实际运行配置为 `approval_policy=never`，宿主未提供配置 Auto-review 的工具参数，不能宣称已启用。
