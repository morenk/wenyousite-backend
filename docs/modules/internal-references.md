# 站内传送门 v1

站内传送门是跨帖子组织内容的最小坐标协议。机器事实源为 [`contracts/internal-reference-v1-fixtures.json`](../../contracts/internal-reference-v1-fixtures.json)，协议标识 `wenyousite-internal-reference`，版本 `1`。它不新增数据库字段或解析接口，也不查询目标标题、楼层号、作者或权限。

## 可识别坐标

- 主题帖：`/threads/{threadId}`
- 子贴：`/threads/{threadId}?subthread={subthreadId}`
- 主楼层：`/threads/{threadId}?post={postId}`
- 楼中楼讨论：`/threads/{threadId}/posts/{floorPostId}/replies`
- 具体楼中楼回复：上一地址增加 `?post={replyPostId}`
- `https://wenyou.site` 下的同形绝对地址规范化为相对地址；站外来源、片段、未知或冲突查询参数不识别。

`post` 是精确定位，路由层优先于 `subthread`。选择非默认子贴时 URL 使用 `subthread`；选择默认子贴时删除该查询参数。无效子贴参数回落到默认子贴并清理 URL。切换子贴使用 history replace，左右游标、目录菜单和复制当前子贴链接共享同一地址构造规则。

## 显示与写入

- 显式 `\[设定 A\]\(/threads/…\)` 只显示用户命名的“设定 A”。
- 裸站内坐标只显示默认名称“传送门”。
- 所有目标类型共用同一种正文内联样式，不显示“楼层 / 回复 / 子贴”等系统 label，也不渲染卡片或远程摘要。
- 帖子继续使用 Markdown v2 的普通链接编辑能力；动态正文和评论仍是字符串，只额外识别上述显式语法与裸地址，其他 Markdown 和外链保持字面文本。
- 构造器必须写入规范化相对地址，并允许把当前选择文本作为名称。动态正文最多 1000 字、评论最多 500 字的原有限制包含标记本身。

## 安全与降级

传送门解析是纯语法操作，不验证目标存在性和可见性。点击后由既有主题详情 404 与权限逻辑决定结果，列表、摘要和编辑器不得提前泄漏私密目标元数据。站内传送门同标签页导航，普通站外链接沿用各端既有外部导航策略；无障碍名称为 `站内传送门：{显示名称}`。

旧客户端可以把语法显示为普通字符串或普通 Markdown 链接，不需要迁移历史内容。动态摘要把显式传送门替换为名称、裸地址替换为“传送门”，再执行既有截断。
