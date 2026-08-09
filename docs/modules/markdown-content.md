# Markdown v2 正文协议

## 目标与范围

本模块定义 Web、后端与 Flutter 共用的正文存储协议。机器契约分为两层；自然语言文档只解释规则，不能覆盖黄金语料的预期结果：

1. [`contracts/markdown-v2-fixtures.json`](../../contracts/markdown-v2-fixtures.json) 固定正文的 `canonical` 与 `visible`，用于写入规范化和发布可见性。
2. [`contracts/markdown-v2-nodes-fixtures.json`](../../contracts/markdown-v2-nodes-fixtures.json) 固定扩展节点的 `nodes`、`serialized` 和复制身份规则，用于解析、序列化与编辑器 round-trip。

v2 在 v1 规范化基础上增加收藏表情的标准 Markdown 图片标记与发布安全边界。旧客户端无需识别扩展标记，也能按普通图片显示。

## 格式版本

- 协议标识：`wenyousite-markdown`
- 版本：`2`
- 存储格式：UTF-8 Markdown 字符串
- 标准换行：LF（`\n`）
- 顶层空段落：独占一行 `<br />`

## 规范化规则

1. CRLF/CR 统一为 LF。
2. 围栏代码块外，顶层独占行 `<br>`、`<br/>`、`<br >` 统一为 `<br />`。
3. 围栏代码块外移除空 URL 图片 `![alt]()`；代码内容保持原样（换行规范化除外）。
4. 不做全局 `trim`，不删除首尾空段落，不做 Unicode NFC/NFKC 转换。
5. 不删除零宽连接符或变体选择符，避免破坏组合 Emoji。

## 发布可见性

- 普通文字、纯数字、非空列表、有效图片、非空代码块、裸 HTTP(S) URL、CommonMark 自动链接和带可见标签的链接可发布。
- 纯空白、仅空段落、仅分隔线、空图片、空链接和仅由默认不可见 Unicode 字符组成的正文不可发布。
- 默认不可见字符只在可见性判断时忽略；与可见字符组成 Emoji/文字时不影响发布。
- 围栏关闭标记必须与开启标记同字符，且长度不少于开启标记。

## 图片与收藏表情

- 收藏表情写为 `![表情](ASSET_URL "wenyousite-sticker:v1:ASSET_ID")`。`v1` 是表情标记自身版本，与 Markdown v2 版本相互独立。
- 新增表情必须仍在作者的私有收藏中，URL 和资产 ID 必须匹配；每篇内容最多 20 个。
- 新增普通图片必须是作者本人状态为 `COMPLETED` 的站内 `Media`。编辑历史正文时，原有外链图片出现次数可保留，但不得新增或复制；普通超链接不受影响。
- 表情、普通图片和规则外观相似的文本在围栏代码或成对行内代码中都不触发资产校验。

## 跨端执行方式

- 后端是写入和发布校验的最终权威。
- Web 和 Flutter 必须加载或复制同版本的两层黄金语料：逐条验证 `canonical` / `visible`，以及 mention、`@全体玩家`、dice、sticker、普通图片的 parse / serialize / round-trip。
- 扩展节点不得在围栏代码、成对行内代码或反斜杠转义位置解析。骰子复制粘贴生成新 `nodeId`，剪切粘贴保留；提及 `userId` 和表情 `assetId` 在复制时保留。
- 任一规则变更必须新增/修改语料并提升协议版本；不得只修改某一端的正则。

## 后端写入边界

- `PostsService.create`、`upsertBody`、`update` 在发布校验前规范化正文，存库、提及解析和通知摘要统一使用 canonical 内容。
- `DraftsService.create`、`update` 在写库前规范化正文；草稿不执行发布可见性限制。
- DTO 长度校验仍在服务调用前执行，后端规范化不会把超长请求绕过为合法请求。

## 自动门禁

- 黄金语料必须是合法 JSON 且 case id 唯一；规范化函数通过全部 canonical case，可见性函数通过全部 visible case。
- 扩展节点语料覆盖解析、序列化、代码边界、转义和复制身份规则。
- 帖子创建、正文 upsert、帖子编辑及草稿写入在进入持久化和下游事件前统一规范化。
