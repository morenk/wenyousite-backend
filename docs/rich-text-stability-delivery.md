# 富文本测试与兼容交付记录

本记录关联移动端 [计划 PR #16](https://github.com/morenk/wenyousite-mobile/pull/16)，职责为 Backend 测试契约、离线执行与兼容校验。消费入口见 [编辑行为契约](modules/rich-text-behavior.md)。不改变业务 HTTP、数据库、Markdown v5 或 Foundation，不替代 Web/Flutter 的实际操作与负责人验收。

## 工具与结果

```bash
pnpm test:rich-text
pnpm contract:rich-text --check
pnpm --silent contract:rich-text --backend > /tmp/rich-text-backend-results.json
pnpm contract:rich-text --compare /tmp/rich-text-backend-results.json
pnpm contract:rich-text --compare /tmp/rich-text-web-results.json
pnpm contract:rich-text --compare /tmp/rich-text-flutter-results.json
```

`--backend` 仅对已提交合成 fixture 执行实际 prepareMarkdownContent、骰子解析和独立 Markdown AST 摘要。源码 SHA 来自当前 HEAD；生成可交接结果前必须确认源码已提交且工作区干净。结果有明示 offline 身份；不连接数据库或执行实际保存请求。编码失败检查点显示 not-run/not-applicable，不伪造客户端结果。

`--compare` 先校验 schema 与 fixture SHA-256，再逐阶段比较。Web/Flutter 必须提供 initial 的 decoded、每个 step 的 edited、每个检查点的 serialized/reader，以及有选区或保存预期时的 selection/save；编辑器重开后的默认光标无预期时不比较。缺失、重复、未知用例、失败和适用阶段未执行都会使比较失败；结果上的 passed 不能覆盖实际差异。默认诊断只有 caseId/stepId/stage/字段路径，无正文与身份值。

不适用必须逐项明确记录，不能省略：canonical=null 的阅读/后端校验没有当前正文输入；Web 的两个移动端本机快照 close 检查点不存在对应操作。完整边界见 [结果阶段适用性](modules/rich-text-behavior.md#结果与分阶段诊断)。编码失败的编辑结构、选区、序列化失败与保存保护仍必测；正常阅读及 Flutter 关闭不会因该例外免测。CLI 将实测通过数与 N/A 项分开输出。

## 门禁证据与限制

- newline 原门禁清单未列该文件。隔离测试创建真实后端/两个客户端目录，从候选脚本移除仅新增的 newline 条目模拟前置清单：文件相同时均通过；仅客户端 newline 多一个字节时原清单通过、候选失败，并指明客户端和文件。三个原条目仍逐一拒绝漂移；缺失参考目录/文件继续原有 existsSync 规则。测试不写主目录或其他任务语料。
- 独立摘要覆盖新多步序列、原 v7 全部 48 条样式组合与原节点语料；保留 LF、段落、引用归属、空段、marks、链接目标及原子身份。测试对摘要、结果完整性和 fixture hash 注入错误，确认比较器能拒绝。
- 共享拒绝样例通过八类实际 Service 方法执行，每例重复两次，断言事务、帖子/草稿写入、骰子生成、媒体同步等没有发生；依赖使用 mock，故属于服务单元测试，不是 Prisma/公网 API 集成证明。
- Web RT-10 与移动关闭保护分别由客户端独立任务做真实页面编码失败注入，候选结果不在本后端分支冒称完成。专用账号双向 API 保存、候选 APK/浏览器资源身份和负责人原场景仍属于后续跨端验收。

## 能力、停止与回退

| 声明能力 | 基础 Markdown v3 | v4 块对齐 | v5 独立图片对齐 | 引用显式空行 | 无损保护 |
| --- | --- | --- | --- | --- | --- |
| legacy-v3 | 完整读/建/改 | 安全阅读降级，禁止覆盖编辑 | 同左 | 同左 | 未由版本号证明 |
| legacy-v4 | 完整读/建/改 | 完整读/建/改 | 安全阅读降级，禁止覆盖编辑 | 同左 | 未由版本号证明 |
| legacy-v5 | 完整读/建/改 | 完整读/建/改 | 完整读/建/改 | 需独立能力证据 | 未由版本号证明 |
| candidate-v5 | 完整读/建/改 | 完整读/建/改 | 完整读/建/改 | 需消费结果通过 | 需真实失败注入通过 |

表中能力描述给定正文而非整个应用；所有写入仍需权限、内容与资源归属校验。离线 profiles 是最小能力集合，并非把所有旧 APK 都认定相同。未证明完整结构支持、无损 roundtrip 或 profile 未知时阻断该内容的编辑保存，保留原文和最后有效快照；安全阅读降级不产生可覆盖原文的新来源。

能力矩阵的允许/拒绝由 compatibilityCases 和实际离线政策逐例验证。停止条件为结构/marks/身份不一致、字节规范化持续变化、未知结构可被覆盖、编码失败仍提交或退出；这些字段分别有比较器负向测试。先发布读取与保护能力，后开放对应写入；旧版本无法读新内容时不得只回退进程，应停止扩大写入并保留兼容读取实现。该说明不授权停止线上入口、部署、回退或推荐 APK。

## 尚未统一的组合预期

已读移动端已提交 2fb2242 的引用边界测试：跨引用段退格会合成一个段落；局部引用改 H2/取消引用有独立期望。它们是已存在的单端回归，应优先映射为共享语料，不重开已验收 Enter/H2/引用标记。引用跨段退格及 Enter 撤销/重做已映射至 revision 2；局部块转换的跨端规范分隔写法、部分组合选区与段内多块粘贴的拆段边界和最终选区仍需协调核对。RTM-11 的对齐策略已由负责人明确为继承光标所在目标段落的对齐排版，不保留粘贴来源的冲突对齐属性；该新决定已记录，尚无对应消费端实测证明。未提交的列表/空格式块调查不作为协议输入。

实际前置脚本核对：测试移除新增 newline 一行后的源码与 `6bfb818:scripts/check-doc-truth.ts` 逐字一致，SHA-256 为 `8447b0a5c83e8a34cacd0a5a257b2e990d1325898d80bd054f4c4faed9016fb2`；红绿差异不是修改其他文档门禁造成的。

兼容保留项及收紧前证据见 [富文本兼容保留登记](deprecation-register.md)。
