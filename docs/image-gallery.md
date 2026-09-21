# 全屏图片图集契约

新增 `GET /api/v1/image-gallery`，OptionalAuth。每次请求重新校验原内容权限、拉黑与删除状态。只查询已发布普通图片；不收录头像、表情、代码示例或本机待完成附件。

## 请求与响应

首次请求：`scope`、`scopeId`、`anchorId`、`anchorIndex`（普通图片从 0 开始）、`anchorVersion`（正文/动态现有 version；不可编辑评论固定 1）。可选 `order=OLDEST|NEWEST`、`authorId`、`limit`（默认 20、1–50）。动态一级评论默认 NEWEST，其余默认 OLDEST。续页仍传相同 scope/scopeId/order/authorId，使用服务端 previousCursor/nextCursor，不得解析或拼接游标。

| scope | scopeId | 收录范围 |
| --- | --- | --- |
| SUBTHREAD | 子贴 ID | 正文，置顶主楼层，普通主楼层；不含楼中楼 |
| POST_REPLIES | 主楼层 ID | 该楼层的楼中楼；不含主楼层本身 |
| MOMENT | 动态 ID | 该动态正文配图 |
| MOMENT_COMMENTS | 动态 ID | 一级评论配图；不含回复 |
| MOMENT_REPLIES | 根评论 ID | 该评论的全部回复配图；不含根评论 |

成功 envelope 的 data 为 `{items, previousCursor, nextCursor, anchorItemId}`。首次页围绕点击图片，续页按阅读顺序返回。cursor 为 null 表示该方向没有更多；不返回不可靠的全局图片总数。anchorItemId 首次为点击图片 ID，续页为 null。

每个 item 包含 `id`、`sourceId`、`sourceVersion`、`imageIndex`、`imageCount`、`url`、`display`、`width`、`height`、`animated`、`threadId`、`subthreadId`、`parentPostId`、`momentId`、`parentCommentId`、`floorNumber`。不适用的定位/媒体属性为 null；animated 未知为 false。display 复用现有完整 WebP 展示描述。imageIndex/imageCount 仅表示这段正文或这一条动态内部的普通图片位置，不是图集全局进度。同 URL 多次出现保留独立位置。

正文 item ID 为 `post:<sourceId>:<sourceVersion>:<imageIndex>`；动态为 `moment:<sourceId>:<sourceVersion>:<imageIndex>`；评论为 `comment:<sourceId>:1:0`。客户端只把 ID 当作稳定键，不能据此访问未授权资源。

## 会话、排序与错误

SUBTHREAD 顺序固定为正文、打开时置顶的主楼层（pinnedAt 倒序/id 倒序）、非置顶楼层（floorNumber 按 order）；每段内部图片始终正序。作者筛选遵循原楼层可选作者资格，正文不受楼层作者筛选影响。POST_REPLIES 和评论按 createdAt/id 的 order 排序；动态正文按 sortOrder。MOMENT 不接受 authorId，其他 scope 的 authorId 只筛选当前层级。

游标固定 scope、方向、排序、作者、打开时间以及置顶顺序；打开后新增内容不混入会话。每次续页检查边界图片的版本与身份。编辑导致锚点失效返回 HTTP 409 / CONFLICT，提示重新打开；不静默跳到同位置的另一张图。对象不可见返回 404；游标格式、会话条件不匹配返回 400 / INVALID_CURSOR。客户端遇失败保留当前图并提供重试；409 要重新加载会话。

## 索引与发布

新增 post_image_occurrences：每个 Post 按普通图片出现位置保存 URL，主键 `(post_id, image_index)`。正文写入与索引替换在同一事务；该索引不替代授权与媒体引用账本。历史通过有界、幂等、可审计的独立回填入口处理，默认 dry-run；线上执行须另行授权。先完成兼容后端迁移、回填与校验，再发布移动端。未回填历史内容不会伪装完整图集。

正式 Markdown、上传 API 和 COMPLETED 语义不变。Web 可继续使用原入口，无迁移要求；Foundation 不新增视觉 token。
