# 主题帖文本颜色 v1

本协议是独立内联扩展，不改变全局 Markdown 5 或角色提及 6 协商。机器语料见 [fixtures](../contracts/markdown-text-color-v1-fixtures.json)，解析结果见 [schema](../contracts/markdown-text-color-v1.schema.json)。Backend 是语法事实源，Foundation 及消费者只同步已提交版本。

## 源码与编辑

规范源码为 `<span data-wenyou-color-v1="#RRGGBB">内容</span>`。仅接受不透明六位 RGB，输入十六进制大小写均可，持久化输出为大写；属性名、标签名、引号及空格严格按示例，不接受多属性、CSS、透明度或普通 HTML。span 非空、不能嵌套或跨物理行；跨段/软换行选区拆为独立 span。颜色为最外层内联标记，内侧可含平衡的粗体、斜体、删除线、普通链接和行内代码，不能跨越其边界。

图片、音频、表情、骰子、账号/RP 提及和站内引用均为原子节点，不进入颜色 span；选区及复制时拆开这些节点，保留原子源码。标题（H2/H3）、引用及列表的块前缀在 span 外侧。转义源码、行内代码及代码块中的同形标记为字面文本，不解析为颜色。音频排除指媒体元数据已识别的播放器原子，普通链接仍按链接处理，不根据 URL 扩展名推测音频。颜色始终显示作者输入的原始 RGB，明暗一致，不自动调色或提示对比度。

## HTTP 能力与关闭语义

`/meta.capabilities` 增加 `textColorV1Supported` 与 `textColorV1WriteEnabled`，缺失都按 false。`TEXT_COLOR_V1_ENABLED` 默认 false，只控制新写。读取用 `X-Text-Color-Version: 1`，与角色提及头并行；未声明时只移除响应副本里的有效颜色标签，保留原始文字及其它 Markdown。所有相关响应追加 `Vary: X-Text-Color-Version`，缓存只保存源值。

主题创建、子帖创建、楼层/回复创建与编辑、BODY upsert、聚合编辑、草稿创建/覆盖/更新 DTO 均增加可选 `textColorVersion: 1`。支持新端应始终发送，包括删除全部颜色。新或原文含颜色且未声明返回 HTTP 409 / `TEXT_COLOR_CAPABILITY_REQUIRED` (40016)。格式错误返回 HTTP 400 / `INVALID_TEXT_COLOR` (40018)。新写关闭时新增范围、改变颜色或修改已着色范围内容返回 HTTP 409 / `TEXT_COLOR_DISABLED` (40017)；完整保留或移除已有范围允许。关闭时以 `(RGB, 受控内联语义)` 完整连续范围的多重集合判定保留：叶子包含文字、粗体/斜体/删除线/代码/链接（含 href/title）mark，忽略等价 delimiter 和实体编码，合并相邻等 mark 叶子；源码直接相接且 RGB 相同的 span 合并为一个范围，不跨未着色内容或不同 RGB。允许重排、删除完整范围，禁止增加计数、改字或改 mark；不使用字符多重集合。用户仍可编辑未着色范围，或先恢复默认色再编辑。

草稿和 BODY 覆盖保护使用已保存原文及乐观锁，不能凭新文是否含标签判断。幂等重放不创造新写。此扩展不用于动态、私信和主题标题；没有迁移、没有清理旧 Markdown/提及协议。

## 摘要、导出与发布

列表预览、搜索摘要、通知与纯文本导出移除有效颜色标签，代码/转义的字面标签保留。Markdown 导出在声明颜色能力时保留受控颜色源码；未声明则输出去色副本。导出对角色提及的独立保源规则不变。

发布顺序为兼容后端 → 可读保源消费者 → 明确启用新写。任何合并、Tag 和部署仍按各仓库门禁另行执行。回滚时关闭新写仍须保留读取、已有颜色保存/移除和旧端覆盖拒绝。

## 剪贴板及去色安全

沿用 [剪贴板 envelope v2](../contracts/editor-clipboard-v2-fixtures.json)，只扩展严格白名单 span 属性 `data-wenyou-color-v1`，不读取 `style=color`、RGB CSS、其它属性或外部 HTML 格式。Mobile 本机结构化 Delta 保留颜色，系统剪贴板仍遵循原纯文本互操作边界。

旧端去色须按整段内联 token 流移除颜色并重新序列化，合并相邻同类样式和代码、保护首尾空白，再转义字面标点，不能简单 replace 标签后再解释。比如有色 `# 标题` 必须投影为 `\# 标题`，有色 `***` 投影为 `\*\*\*`；保留真正粗体、链接和代码语义。fixtures 的 fallback 为规范化安全输出，不承诺与原内部源码逐字节一致。
