# 主题帖文本字体 v1

Backend 是字体身份、正文标记与资源目录的事实源。Web、Flutter 和 Foundation 只同步已提交 Git SHA；本文不改变全局 Markdown 5、角色提及 6 或 UI 系统字体。机器契约为 [解析结果 schema](../contracts/markdown-text-font-v1.schema.json)、[共享语料](../contracts/markdown-text-font-v1-fixtures.json) 和 [29 家族目录](../contracts/thread-font-catalog-v1.json)。资源构建见 [字体资产](thread-font-assets.md)。

目录 1.1.1 包含中文 13、日文 10、英文 6，共 29 家族，分类使用 `designLanguage`。站酷小薇体为未发布候选，已移除。小城拉风体原 ZIP 已核验，仅以原字节分发并使用固定哈希预算例外；Special Elite 为 Apache-2.0。29 款资产已构建核验，实际状态以 manifest 为准。缺字按字符回退，不能把可用状态或语言类别当作覆盖率。怪盗予告黑体已锁定用户提供的原 ZIP，按 OFL-1.1 构建固定分片。

## 正文与组合

字体单独使用：`<span data-wenyou-font-v1="wenkai">文字 Hello</span>`。

与颜色组合：`<span data-wenyou-font-v1="wenkai" data-wenyou-color-v1="#D14343">**粗体**与*斜体*</span>`。

规范开标签先字体、后颜色；输入接受两个属性的相反顺序并规范化，颜色继续规范为大写 RGB。只有这两个属性允许共存，不允许嵌套 span、重复属性、CSS、任意字体名称、字体 URL、空区间或跨物理行区间。`fontId` 只接受目录 v1 的白名单，版本由属性名确定，不把资产文件名或资源版本写进正文。每个家族首批只分发一个默认字款；OFL 派生资源将注册元数据规范为 `baseWeight: 400` / `baseStyle: normal`，保留原字形轮廓。粗体与斜体仍是独立 Markdown marks，客户端使用一致的合成策略并实测效果，不能把字重算作额外家族。

span 是最外层行内标记，内部允许平衡的粗体、斜体、删除线、普通链接和行内代码。标题、列表、引用前缀在 span 外。图片、表情、音频原子、骰子、账号/RP 提及、站内引用不进入 span；跨行和跨原子选区拆为独立区间。转义、代码、链接地址与 title 中的同形源码不激活字体。普通文本和动态、私信、标题不获得此正文能力。

## HTTP 协商与保存保护

`/meta.capabilities.textFontV1Supported` 表示可读取/保存字体协议，`textFontV1WriteEnabled` 表示允许新增或修改字体范围；缺失按 false。`TEXT_FONT_V1_ENABLED` 默认关闭，资源就绪及客户端验收完成后才能显式开启。

`GET /meta/text-fonts` 返回固定目录、每项 `ready`/`pendingSource`/`pendingLicense`、manifest 的相对路径/SHA-256/字节数和运营配置的 `assetBaseUrl`。未发布时 base 为 null，客户端不尝试上游下载；`TEXT_FONT_ASSET_BASE_URL` 必须是自有 HTTPS 静态前缀且以 `/` 结尾。源输入 URL 只供离线构建审查，不是运行时兜底。缺少该配置或构建 manifest 时新写仍关闭。目录响应缓存 300 秒；资源按内容哈希不可变缓存。

读取使用 `X-Text-Font-Version: 1`，写入 DTO 使用 `textFontVersion: 1`；二者各自声明，不能用请求头替代 DTO。支持新端在所有正文写入始终发送 DTO 能力，包括删除全部字体。字体与颜色独立协商，组合 span 同时需要 `textColorVersion: 1`。响应 `Vary` 同时包含字体、颜色和角色提及能力头，缓存保留源值，每次仅投影当前响应副本。

| 字体读取能力 | 颜色读取能力 | 组合 span 的读取结果 |
| --- | --- | --- |
| 1 | 1 | 保留两个属性 |
| 1 | 缺失 | 仅保留字体 |
| 缺失 | 1 | 仅保留颜色 |
| 缺失 | 缺失 | 安全 Markdown 文字与其它 marks |

主题/子帖创建、楼层/回复创建和编辑、BODY upsert、聚合保存、云草稿创建/按槽覆盖/更新均执行相同保护。新正文或已保存原文含字体、但 DTO 未声明能力时返回 HTTP 409 / `TEXT_FONT_CAPABILITY_REQUIRED`（40019），即使旧端曾读到去字体副本也不能覆盖原文。格式或未知字体 ID 返回 HTTP 400 / `INVALID_TEXT_FONT`（40021）；拒绝发生在持久化和异步副作用之前。

新写关闭时，新增范围、改字体、改已有字体范围内文字或 marks 返回 HTTP 409 / `TEXT_FONT_DISABLED`（40020）。允许完整保留、重排或移除已有范围，并编辑无字体文字。判定使用 `(fontId, 文字与内联 marks)` 连续范围多重集合；相邻同字体区间可合并，不能复制范围增加计数。颜色独立变化不算字体变化，但仍受颜色自己的门控。幂等重放、版本冲突与事务边界沿用现有机制。

## 阅读、编辑与回退

未知、失效、离线、下载失败、哈希不匹配、缺字或达到加载预算时，使用客户端原系统字体显示文字；保留编辑文档中的 `fontId`，不能因一次加载失败清除标记。服务端新写只接受已知白名单；今后退役必须保留身份兼容规则并独立评审，不能直接删目录导致历史内容无法编辑。

去掉最后一个样式属性时，按完整内联 token 流重序列化，防止移除 span 后将字面 `#`、`>`、`*` 激活为 Markdown，或合并相邻粗斜体分隔符。还保留另一属性时，仅替换开标签。共享语料的 `fontOnly`、`colorOnly`、`legacy` 是规范安全输出；两端必须消费四种组合，覆盖编辑、重开、删除、草稿恢复、撤销和复制粘贴。

沿用剪贴板 v2 envelope，仅扩展受控 span 属性。外部 HTML 的 `font-family`、任意 `style`、CSS URL 均不转成本站字体；未知 envelope/属性回退可见文字。Mobile 本机结构化复制保留字体，系统剪贴板继续遵守现有纯文本边界。

列表预览、搜索摘要、通知与纯文本导出去掉字体和颜色；Markdown 导出根据两个读取头分别保留属性，不把字体二进制塞进 ZIP。对齐与角色提及的既有导出规则保持。

## 消费者迁移与发布

1. 从 Backend 已提交 SHA 同步 OpenAPI、字体 schema/fixtures、目录及资源 manifest；记录源 SHA，不能复制未提交协议。
2. 阅读器、编辑器、草稿恢复、所有保存入口和剪贴板先实现无损保源与四种能力组合，再发送能力声明；未完整实现时保持旧端保护。
3. 读取字体元数据不等于下载所有字体。选择器使用小型预览资源或已知本地文字回退；仅可见正文所需字体按固定分片加载。磁盘缓存与 Flutter 进程注册预算分别执行，删除缓存不代表卸载 FontLoader。
4. 兼容后端、Web 和 Windows Flutter 各自检查并提交；资源由独立批准的发布操作上传自有存储/静态来源。明确验收后才启用新写。VPS 不声称执行 Flutter 门禁。

连续浏览的可续用网络窗口、Web 活动集合和 Mobile 固定注册快照由独立[运行策略 v2](thread-font-runtime-policy.md) 定义，不改变本文的正文或剪贴板协议。

本阶段不做数据库迁移、不清理旧协议、不修改系统 UI 字体、不开放用户字体上传、动画、渐变、透明度或 RP 效果模板。回滚关闭新写，同时保留读取、历史范围保留/移除和旧端覆盖拒绝。
