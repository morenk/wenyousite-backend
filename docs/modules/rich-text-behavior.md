# 富文本编辑行为测试契约 v1

正文仍为 Markdown v5；本契约只承载合成测试和离线诊断，不是 HTTP 字段、数据库模型或第二份正文。保留 newline v1 revision 2 的全部 27 条操作与 roundtrip v7 的全部 48 条操作，消费者必须同时执行引用语料，不能只运行新增样例。

## 输入与独立预期

- [fixture](../../contracts/rich-text-behavior-v1-fixtures.json)、[fixture schema](../../contracts/rich-text-behavior-v1.schema.json)、[结果 schema](../../contracts/rich-text-behavior-results-v1.schema.json) 均从已提交的 Backend SHA 同步。schema 使用 JSON Schema draft-07；结果 schema 的相对引用需同时加载行为 schema。
- `initial` 和每步 `expected` 的 summary/Markdown 由规则独立编写，禁止用待测编解码器刷新答案。`canonical` 是该用例约定写法，不是要求后端重排所有等价 Markdown；服务端只执行现有规范化和骰子规范化。`canonical: null` 表示本步编码失败，不得回退提交前一次成功值。
- `summary.blocks` 是有序树。paragraph/heading 包含 alignment 和内联 children；blockquote 保留 children 的段落归属。空 paragraph 的 children 为空；softBreak 是段内 LF，不能与两个 paragraph 或空 paragraph 合并。text 的 marks 是稀疏对象；相邻同 marks 的 text 合并，不能跨 softBreak、原子节点或不同链接合并。image、sticker、mention、mentionAll、dice 的身份字段逐项比较；骰子结果不在正文摘要中。
- selection 的 anchor/focus 使用 blocks/children 的明确块路径，末端必须是 paragraph/heading；offset 在其内联内容中按 UTF-16 code unit 计数，softBreak 与原子节点各占 1。保留 anchor/focus 方向，不用重复文本首次匹配定位。Emoji 删除由 `unit: grapheme` 指定，不把 UTF-16 code unit 当作用户删除单位。
- 每个 step 执行一次 operation。`historyBoundary: true` 要求测试适配器在该操作前后建立编辑器原生独立撤销边界；不规定内部栈。copy 保留选区；paste 替换当前选区。`regeneratedIds` 是合成测试注入的 UUID 序列，生产仍生成新身份。undo/redo 恢复该事务对应结构和选区。
- `reopen` 是序列化后重新解析；不指定选区时不比较编辑器默认光标。引用历史独占 `>` 仍是段落边界，`> <br />` 才是真空行。历史 LF 不推断按键来源。

## 保存、失败与关闭

`save` 描述受控接口响应，不访问公网。network-error、conflict、unsupported 即使输入本身合法，也由测试传输适配器注入对应失败；不得把 mock 40009 当成该合成正文被后端真实拒绝。encode-error 在成功初始化和正文 A 同步后注入下一次提交序列化，不能在挂载前注入。

`expected.save.requestMarkdown: null` 表示没有 HTTP 提交；persistedMarkdown 是最后成功持久化的正文，dirty 表示本地还有未持久化修改。target 默认 server；local-snapshot 用于关闭时本机快照，成功也不发送 HTTP。失败保留编辑结构和最后有效持久化值；关闭失败 navigation 必须 stay，恢复编码且快照成功后才能 close。若客户端自动快照先于本用例动作，测试适配器应固定计时以建立明确初始快照。

recover 是测试安排：恢复注入故障并显式重试。conflict 的 explicit-retry-after-reload 必须先模拟读取当前服务端版本、保留本地编辑并显式确认，再以新版本重试；不是生产自动覆盖冲突的授权。失败测试证明异常保护，不代表已复现或修复用户原始丢稿问题。

## 能力与未知内容

profiles 是声明的最小能力组合，不是对所有历史 APK 的推断。legacy-v3/v4/v5 分别具有基础、块对齐、图片对齐能力；Markdown 数字 5 不证明支持引用空行、newline revision 2 或无损保存保护。candidate-v5 只有在消费者执行结果证明后才能用于发布判断。

compatibilityCases 中 read=full 表示可完整表达语义；safe-fallback 只允许安全阅读降级并保留原文，不能把降级后的文字当作原正文覆盖保存。create/edit 还需要相应特性且 lossless=true；未知 profile、未知协议或不安全结构阻断创建/编辑，不能借编辑旁边一段文字静默删除未知部分。这里的 create 是“创建该给定正文”，不是禁用整个应用创建入口。后端已有原始 HTML/未知协议拒绝规则不变；客户端原文保护由消费端接入，离线政策验证不冒称线上已具备客户端保护。

## 结果与分阶段诊断

结果绑定 fixtureSha256、sourceRevision、platform 和 environment。每项 observation 固定 caseId、stepId（初始状态用 initial）、stage（decoded/edited/serialized/backend/reader/selection/save）与 status。passed/failed 应附 actual；not-run 附原因，不得以 backend 的离线校验冒充编辑器按键、真 API 或负责人设备验收。

比较器只报告第一处差异的 case/step/stage/字段路径，默认不回显正文、链接、身份、Cookie 或请求体。样例均为合成内容；跨端交接仅使用版本控制的 fixture 和按结果 schema 生成的本地测试产物，不上传真实正文。未知输入不允许自动写入 fixture。

## 接入与发布边界

按“已提交契约 → 读取与未知内容保护 → 对应写入口 → 双向合成保存 → 负责人验收”推进；不改变 `/meta`、HTTP/OpenAPI、Markdown v5 或 Foundation 版本。旧客户端缺少新写法读取/保护证据时，不把只测试旧进程启动作为回退成功；应停止相关写入口的继续开放，并保留当前内容和可用兼容读取版本。合并、部署、停止线上写入口、回退与 APK 晋级都须另行授权。

停止条件包括语义摘要不等、规范化不幂等、身份改变、未知内容可被覆盖、编码失败仍提交/退出。回退仅撤销对应消费者候选或离线工具；不运行内容迁移、不自动删除引用空行、不降级历史对齐。

RT-01 普通 Enter 对齐、RT-02 空 H2/H3、RT-03 引用标记拆分已有负责人验收；RT-04 引用内部额外空行独立原场景仍待验收。列表/空格式块由原并行任务交付。负责人已明确 RTM-11：光标直接位于某段落内粘贴时，遵循目标段落的对齐排版。例：在居中“甲|乙”内粘贴来源居右的“丙”，采用目标段落的居中对齐，不沿用来源居右属性。这只确定对齐策略；多块粘贴的拆段边界和最终选区仍列在 fixture.deferredDecisions，须确定独立预期后补充操作语料。部分块转换的未明确预期同样保留待确认；消费端不得自行发明规则。

工具命令、执行证据和各阶段适用范围见 [富文本测试与兼容交付记录](../rich-text-stability-delivery.md)。

fixture revision 2 去除引用结束后顶层空段前无必要的源码空行；该处有无源码分隔空行均被现有后端接受且独立结构相同，测试选择已有空段规范写法，不要求客户端增加空行。新增引用跨段退格和 Enter 撤销/重做来自已提交移动端 2fb2242 的独立回归；原 newline 27 条及 v7 48 条不变。

未知内容只读且没有新增编辑时，允许原始 source 快照成功后退出，不要求先执行有损 flush；若存在未编码的新编辑，仍按关闭失败保护阻断退出。原文快照失败也必须留在页面。离线 close-policy 测试区分这些状态，实际页面行为由各消费端验证。
