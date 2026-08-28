# Markdown v3 正文协议

## 目标与事实源

本模块定义 Web、后端与 Flutter 共用的正文存储和工具栏能力白名单。机器契约分为三层，自然语言文档不能覆盖黄金语料：

1. [`contracts/markdown-v3-fixtures.json`](../../contracts/markdown-v3-fixtures.json) 固定规范化、可见性、允许/拒绝结果、首个不支持类型和字面降级结果。
2. [`contracts/markdown-v3-nodes-fixtures.json`](../../contracts/markdown-v3-nodes-fixtures.json) 固定扩展节点的解析、序列化和复制身份。
3. [`contracts/markdown-editor-roundtrip-v5-fixtures.json`](../../contracts/markdown-editor-roundtrip-v5-fixtures.json) 固定 `structured` 与 `literal-text` 两类编辑器往返，并以解析后的块语义和行内语义消除相同标点在不同上下文中的歧义。

主题坐标链接仍是普通 Markdown 链接；客户端可额外按 [`站内传送门 v1`](./internal-references.md) 统一其内联视觉和同页导航，不改变 Markdown v3 的存储规则。

## 格式与白名单

- 协议标识：`wenyousite-markdown`
- 版本：`3`
- 存储：UTF-8 Markdown、LF 换行；顶层空段落使用独占一行 `<br />`
- 允许结构：普通段落、H2/H3、粗体、斜体、删除线、行内代码、安全链接/自动链接、图片、引用、普通有序/无序列表、分隔线，以及提及、骰子、收藏表情和协议空段
- 普通列表最多嵌套三层
- 分隔线规范写为 `正文\n\n---\n\n正文`；紧贴上一行正文的历史 `正文\n---` 继续按 CommonMark Setext H2 解析，编辑保存后规范为 `## 正文`
- 当 `* / _ / ~~` 行内定界符包裹的内容以标点或符号开头、结尾，并因紧邻正文而被严格 CommonMark 解析器保留为字面源码时，阅读端和编辑器恢复粗体、斜体、粗斜体或删除线语义；转义定界符、代码、空白边界和普通单词内下划线保持字面文本。编辑器写回时使用字符引用保护相邻正文，不插入可见空格，并把下划线形式规范为星号形式。
- 禁止结构：表格、任务列表、围栏/缩进代码块、H1/H4-H6、显式硬换行、任意原始 HTML、未知协议节点、不安全链接和未知 AST 节点

完整正文阅读态保留普通段落内单个 LF 对应的软换行；主题列表卡片的紧凑纯文本 `preview` 不保留排版，会单遍解码 Markdown 实体并把连续空白折叠成一个空格。

只有 Foundation 工具栏主栏与“更多”面板声明的能力可以成为结构化正文。第三方解析器支持的额外 GFM 语法不扩大产品能力。

## 写入与错误

所有正文入口先统一 CRLF/CR 为 LF、规范化独占空段并清理空 URL 图片，然后执行同一 AST 白名单校验；校验必须早于骰子、图片、表情、提及和持久化处理。

未转义的白名单外结构返回 HTTP 400、`UNSUPPORTED_MARKDOWN_FORMAT = 40009`，响应保持 `{ code, message, data: null }`，message 指出按源码顺序遇到的首个不支持类型。DTO 的 10,000 字限制不变。覆盖入口包括主题创建与聚合保存、楼层/回复创建与编辑、子贴正文 upsert 和云草稿创建/更新；失败不得产生数据库、Outbox、通知、活动、骰子或提及副作用。

客户端对粘贴、手输、重开和草稿恢复中的不支持结构静默转成字面文本，不显示格式提示。阅读端也在交给 Markdown 渲染器前做相同防御降级。服务端不依赖客户端行为，直接 API 调用仍严格拒绝。

## 规范化与可见性

1. CRLF/CR 统一为 LF。
2. 顶层独占 `<br>`、`<br/>`、`<br >` 统一为 `<br />`。
3. 移除空 URL 图片 `![alt]()`。
4. 不做全局 `trim` 或 Unicode NFC/NFKC 转换，不删除首尾空段与组合 Emoji 所需字符。
5. 纯空白、仅空段落、仅分隔线、空图片/链接和仅默认不可见字符不可发布；普通文字、纯数字、普通列表、有效图片和安全链接可发布。

## 扩展节点

- 收藏表情写为 `![表情](ASSET_URL "wenyousite-sticker:v1:ASSET_ID")`；新增表情必须仍在作者收藏中，每篇最多 20 个。
- 新增普通图片必须是作者本人状态为 `COMPLETED` 的站内媒体；编辑历史正文时只可原位保留已有外链图片。
- 骰子复制粘贴生成新 `nodeId`，剪切粘贴保留；提及 `userId` 和表情 `assetId` 在复制时保留。
- 扩展节点不得在成对行内代码或反斜杠转义位置解析；未知协议节点按白名单外格式处理。

## 数据迁移

`pnpm markdown:v3:migrate` 默认只扫描并输出 dry-run 汇总。应用前必须运行 `scripts/backup.sh`，随后使用 `pnpm markdown:v3:migrate --apply --backup-confirmed`。迁移按源码行转义不支持节点、递增 Post/Draft 乐观锁版本、同步骰子与提及派生关系并清理正文缓存；不发通知、活动或业务事件。重复执行不再改变正文或版本，应用后全库不允许残留不支持节点。

## 自动门禁

- 三份 fixture 必须为合法 JSON、case id 唯一，并与存在同名副本的客户端逐字一致；round-trip v5 的 `blockSemantics` 会分别校验输入与规范输出的实际 Markdown 块解析结果，`inlineSemantics` 会校验规范输出的实际行内解析结果。
- 单元测试覆盖每一种允许格式和所有禁止类型，字面输出必须合法且幂等。
- 迁移测试覆盖 dry-run 无写入、版本递增、提及派生关系裁剪和重复规划幂等。
- OpenAPI、错误码文档、CHANGELOG 与生成客户端必须随错误码和契约版本同步。
