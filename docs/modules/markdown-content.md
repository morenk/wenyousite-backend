# Markdown v5 正文协议

## 目标与事实源

本模块定义 Web、后端与 Flutter 共用的正文存储和工具栏能力白名单。机器契约分为四层，自然语言文档不能覆盖黄金语料：

1. [`contracts/markdown-v4-fixtures.json`](../../contracts/markdown-v4-fixtures.json) 固定规范化、可见性、允许/拒绝结果、首个不支持类型和字面降级结果。
2. [`contracts/markdown-v4-nodes-fixtures.json`](../../contracts/markdown-v4-nodes-fixtures.json) 固定扩展节点的解析、序列化和复制身份。
3. [`contracts/markdown-editor-roundtrip-v6-fixtures.json`](../../contracts/markdown-editor-roundtrip-v6-fixtures.json) 固定 `structured` 与 `literal-text` 两类编辑器往返，并校验块语义、块对齐和行内语义。
4. [`contracts/editor-clipboard-v2-fixtures.json`](../../contracts/editor-clipboard-v2-fixtures.json) 固定 Web/Flutter 的复制入口、站内结构片段、外部字面粘贴、对齐属性、原子节点身份与可见文本回退。

主题坐标链接仍是普通 Markdown 链接；客户端可额外按 [`站内传送门 v1`](./internal-references.md) 统一其内联视觉和同页导航，不改变 Markdown v5 的存储规则。

## 格式与白名单

- 协议标识：`wenyousite-markdown`
- 版本：`5`
- 存储：UTF-8 Markdown、LF 换行；顶层空段落使用独占一行 `<br />`
- 允许结构：普通段落、H2/H3、粗体、斜体、删除线、行内代码、安全链接/自动链接、图片、引用、普通有序/无序列表、分隔线，以及提及、骰子、收藏表情和协议空段
- 普通列表最多嵌套三层
- 分隔线规范写为 `正文\n\n---\n\n正文`；紧贴上一行正文的历史 `正文\n---` 继续按 CommonMark Setext H2 解析，编辑保存后规范为 `## 正文`
- 当 `* / _ / ~~` 行内定界符包裹的内容以标点或符号开头、结尾，并因紧邻正文而被严格 CommonMark 解析器保留为字面源码时，阅读端和编辑器恢复粗体、斜体、粗斜体或删除线语义；转义定界符、代码、空白边界和普通单词内下划线保持字面文本。编辑器写回时使用字符引用保护相邻正文，不插入可见空格，并把下划线形式规范为星号形式。
- 编辑器写出行内格式时，格式节点首尾的空白必须作为普通文本放在定界符外，空白数量保持不变；行内代码内部内容不做同类改写。阅读端对历史上恰好一个普通空格误写在格式定界符内、且紧接完整行内代码的正文提供兼容恢复，下一次编辑保存写回规范 Markdown。后端保留收到的 Markdown 原文，不在服务端批量迁移或全局 `trim`。
- 禁止结构：表格、任务列表、围栏/缩进代码块、H1/H4-H6、显式硬换行、任意原始 HTML、未知协议节点、无效对齐、不安全链接和未知 AST 节点

完整正文阅读态保留普通段落内单个 LF 对应的软换行；主题列表卡片的紧凑纯文本 `preview` 不保留排版，会单遍解码 Markdown 实体并把连续空白折叠成一个空格。

只有 Foundation 工具栏主栏与“更多”面板声明的能力可以成为结构化正文。第三方解析器支持的额外 GFM 语法不扩大产品能力。

## 段落对齐 v1

左对齐是默认状态，不写元数据。居中和居右分别在目标块紧邻的上一行写入一个 CommonMark 引用定义；引用定义不会进入普通 Markdown 阅读输出：

```markdown
[wenyousite-align-v1-center]: #
居中段落

[wenyousite-align-v1-right]: #
### 居右三级标题
```

- 标记只能精确写为 `center` 或 `right`，必须顶层、独占一行并紧邻一个普通段落或 H2/H3；左对齐通过删除标记恢复。
- v4 基础规则下，列表、引用、普通图片、分隔线和协议空段不能携带对齐；v5 仅为独立普通图片块增加例外。含文字与普通图片混排的段落仍不能单独移动图片；提及、骰子和收藏表情是内联原子节点，随合法父段落对齐。
- 孤立标记、标记间空行、重复标记、`left` 标记、未知值或未知版本都按白名单外结构拒绝；需要显示同形源码时必须转义。
- v3 正文不含上述标记，是 v5 的严格子集；v4 正文仍可读取和写入。后端已接受并保存 v5，`/meta.markdownContractVersion` 现声明 `5`；Web 与已升级移动端据此开放图片块对齐写入，旧正文无需迁移。

## 图片块对齐扩展

Markdown v5 为普通图片增加独立图片块对齐能力：普通图片单独占据一个顶层段落时，可以消费紧邻上一行的 v1 对齐标记；无标记仍表示默认左对齐。图片与文字混排的段落继续拒绝对齐，收藏表情仍是行内图片并继承其父段落对齐。

后端校验器和 Web 阅读器按 `markdownContractVersion` 选择 v4/v5 规则，黄金样例见 [`contracts/markdown-v5-image-alignment-fixtures.json`](../../contracts/markdown-v5-image-alignment-fixtures.json)。当前 `/meta.markdownContractVersion` 已为 `5`，公共写入和 Web 编辑器可以生成图片对齐标记；v4 客户端仍通过能力门控安全降级，不会被要求读取 v5 写入。

## 写入与错误

所有正文入口先统一 CRLF/CR 为 LF、规范化独占空段并清理空 URL 图片，然后执行同一 AST 白名单校验；校验必须早于骰子、图片、表情、提及和持久化处理。

未转义的白名单外结构返回 HTTP 400、`UNSUPPORTED_MARKDOWN_FORMAT = 40009`，响应保持 `{ code, message, data: null }`，message 指出按源码顺序遇到的首个不支持类型。DTO 的 10,000 字限制不变。覆盖入口包括主题创建与聚合保存、楼层/回复创建与编辑、子贴正文 upsert 和云草稿创建/更新；失败不得产生数据库、Outbox、通知、活动、骰子或提及副作用。

客户端对粘贴、手输、重开和草稿恢复中的不支持结构静默转成字面文本，不显示格式提示。阅读端也在交给 Markdown 渲染器前做相同防御降级。服务端不依赖客户端行为，直接 API 调用仍严格拒绝。

## 剪贴板 v2

- Web 阅读态同一正文内的选区和整篇菜单复制结构化站内片段；Flutter 只让整篇菜单结构化，系统任意选区保持可见纯文本。编辑器内部复制在两端都保留结构。
- Web 结构片段写入 v2 HTML envelope，并始终携带不含 Markdown 定界符、对齐标记和隐藏身份的 `text/plain`。Envelope 只用于来源体验判定，不是认证边界；粘贴前仍必须执行严格节点、属性和 URL 白名单。v2 读取器继续接受 v1 片段，但 v1 不恢复对齐。
- 站内片段用白名单属性 `data-wenyou-align=center|right` 保留普通段落与 H2/H3 对齐，同时保留文字 marks、列表、引用、分隔线、安全链接、传送门、提及与骰子表达式。阅读端图片固定为 `[图片]`，表情固定为 `[表情]`；骰子粘贴生成新 ID 且不继承结果。
- 无合法 v1/v2 标记的 HTML、Word 和 Markdown 全部按可见文字插入，不从 CSS、HTML `align` 或纯文本推断对齐；单独的合法本站坐标继续生成传送门。标记丢失、未知版本和跨端传输均静默退回可见纯文本。

## 规范化与可见性

1. CRLF/CR 统一为 LF。
2. 顶层独占 `<br>`、`<br/>`、`<br >` 统一为 `<br />`。
3. 移除空 URL 图片 `![alt]()`。
4. 不做全局 `trim` 或 Unicode NFC/NFKC 转换，不删除首尾空段与组合 Emoji 所需字符。
5. 对齐引用定义不计作可见内容；纯空白、仅空段落、仅分隔线、空图片/链接和仅默认不可见字符不可发布。普通文字、纯数字、普通列表、有效图片和安全链接可发布。

## 扩展节点

- 收藏表情写为 `![表情](ASSET_URL "wenyousite-sticker:v1:ASSET_ID")`；新增表情必须仍在作者收藏中，每篇最多 20 个。
- 新增普通图片必须是作者本人状态为 `COMPLETED` 的站内媒体；编辑历史正文时只可原位保留已有外链图片。
- 骰子复制粘贴生成新 `nodeId`，剪切粘贴保留；提及 `userId` 和表情 `assetId` 在复制时保留。
- 扩展节点不得在成对行内代码或反斜杠转义位置解析；未知协议节点按白名单外格式处理。

## 数据迁移

现有 v3/v4 正文无需数据改写即可作为 v5 读取。历史清理命令 `pnpm markdown:v3:migrate` 仍默认只扫描并输出 dry-run 汇总；应用前必须运行 `scripts/backup.sh`，随后使用 `pnpm markdown:v3:migrate --apply --backup-confirmed`。迁移按源码行转义不支持节点、递增 Post/Draft 乐观锁版本、同步骰子与提及派生关系并清理正文缓存；不发通知、活动或业务事件。重复执行不再改变正文或版本，应用后全库不允许残留不支持节点。

## 自动门禁

- 四份 fixture 必须为合法 JSON、case id 唯一，并与存在同名副本的客户端逐字一致；round-trip v6 的 `blockSemantics`、`blockAlignments` 与 `inlineSemantics` 分别校验实际块、对齐和行内解析结果；clipboard v2 还必须覆盖 Web/Flutter 六个入口、v1 兼容读取、全部来源降级、对齐规则和六类原子节点。
- 单元测试覆盖每一种允许格式和所有禁止类型，字面输出必须合法且幂等。
- 迁移测试覆盖 dry-run 无写入、版本递增、提及派生关系裁剪和重复规划幂等。
- OpenAPI、错误码文档、CHANGELOG 与生成客户端必须随错误码和契约版本同步。
