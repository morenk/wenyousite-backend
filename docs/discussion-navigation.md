# 讨论固定编号与双向窗口（v1）

契约版本：5.30.0-dev.20261001.1。旧列表、创建、通知与搜索的帖子 ID 深链继续兼容；客户端不应逐页寻找远处目标。

## 请求与响应

- GET /api/v1/subthreads/:subthreadId/posts/window：子贴主楼自然编号窗口。
- GET /api/v1/posts/:id/replies/window：指定根楼下回复自然编号窗口。
- query: number（正整数）、postId（旧帖子 ID）、cursor（三者互斥）；order=OLDEST|NEWEST（默认 OLDEST）、authorId（现有角色作者筛选）、limit（默认20，1–50）。均未提供目标时读取首屏。
- 标准成功 envelope 的 data 为对象：items、pinnedItems、total、maxNumber、target、beforeCursor、afterCursor、hasBefore、hasAfter。无旧分页 meta。
- target 为 {id,number}，仅精确定位响应非 null；items 包含目标及其显示顺序前后小段，最多 limit 条。边缘窗口可少于 limit。
- total 是当前查看者与作者筛选下可见条数（空为0）；maxNumber 是本范围当前查看者全部可访问内容的最大编号（忽略作者筛选，无可访问内容为null），以允许输入其他作者目标并由专用409清筛选定位。固定编号存在删除或不可见空洞，不能当条数、数组下标或连续权限证明。
- before/after 指显示顺序前后，游标已含方向；必须原样回传，order、authorId 与查看者保持一致。签名绑定范围、顺序、筛选和查看者；不需要前面所有页。
- 页面数据实时读取，跨请求新写入可能更新统计；编号游标不受插入、删除边界记录影响。目标窗口和当次统计使用一致事务快照。

## 固定编号与置顶

replyNumber 为根楼内持久正整数，主楼/BODY 为 null；旧客户端可忽略。历史记录包含软删/隐藏，按 createdAt,id 确定性回填。新增在根楼锁内递增，包含软删最大值，不重用编号。兼容触发器保护迁移后短暂运行的旧写入进程；migration deploy 可安全重复执行，不重复回填。主楼原 floorNumber 保持不变。

主楼默认首屏的 pinnedItems 最多10条，按置顶时间倒序，受同一可见性和作者筛选约束。items 始终是含置顶主楼的自然序列。客户端普通阅读会话保留 pinnedIds，在置顶区显示这些卡片，并从自然渲染列表抑制相同 ID；这样后续游标不会漏楼或重复。直接编号/深链定位与阅读位置恢复须清空旧置顶区，目标回到自然位置。每次有界内容最多50条自然楼层另加首屏10条置顶，各楼内联最多5条回复；楼中楼 pinnedItems 恒为 []。

## 错误与消费者行为

- 不存在、删除、拉黑或其他不可见目标统一404/POST_NOT_FOUND，不返回邻居替代目标。
- 目标自身可访问但被当前作者筛选排除：409/DISCUSSION_TARGET_FILTERED=40010。仅此码允许消费者清筛选并重试同一目标一次；不可按所有409或中文消息判断。
- 游标篡改或范围/order/author/viewer不匹配：400/INVALID_CURSOR=40007，应重新获取当前窗口。
- number/postId/cursor并传：400/BAD_REQUEST；非法正整数、limit或order走DTO校验。
- Web/Mobile 限制已加载窗口和预取，目标成功后再替换旧画面；请求过期不得覆盖新跳转。返回阅读点保存帖子ID与条目内偏移，不以可变像素总长定位。

## 验证与发布

pnpm test:integration:discussion-navigation 使用登记并核验的独立 PostgreSQL/Redis，验证真实旧数据迁移与重复deploy、旧写入兼容、并发编号、软删空洞、筛选/拉黑/私密拒绝、首中尾1000/5000/10000回复定位、万主楼/置顶和双向连续性。性能输出区分单次耗时和实际SQL数，不视为生产SLA。自动测试结束由统一runner清理；持续真人预览使用另一批次身份。

合并顺序为兼容 Backend（含迁移）→ Foundation与消费者。旧列表与兼容触发器不在本次删除；任何清理须另PR满足弃用证据门禁。
