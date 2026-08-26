# 收藏模块

## 概述

用户收藏主题帖和动态以便快速返回访问。主题帖夹与动态夹是两套完全独立的用户私有目录，各自拥有“默认收藏夹”，也可分别新建同名目录。不指定分类的快捷收藏会落入对应内容类型的默认夹。主题帖支持公开帖和私密帖收藏，私密帖仅参与人可收藏。

## 涉及的模型

| 模型             | 用途                                       |
| ---------------- | ------------------------------------------ |
| `UserBookmark`   | 用户收藏记录（userId + threadId 联合唯一） |
| `MomentBookmark` | 动态收藏记录（userId + momentId 联合唯一） |
| `BookmarkFolder` | 主题帖私有收藏夹；名称在账号的主题帖夹内唯一 |
| `MomentBookmarkFolder` | 动态私有收藏夹；名称在账号的动态夹内唯一 |

## API 端点

| Method | Path                                  | Guard    | 描述                                      |
| ------ | ------------------------------------- | -------- | ----------------------------------------- |
| GET    | `/bookmarks?cursor=&limit=&folderId=` | AuthRead | 我的收藏列表；folderId 可选，不传返回全部 |
| GET    | `/bookmarks/folders`                  | AuthRead | 我的收藏夹分类与每夹收藏数量              |
| POST   | `/bookmarks/folders`                  | Auth     | 新建主题帖收藏夹分类                      |
| POST   | `/bookmarks`                          | AuthRead | 收藏主题帖；folderId 可选，不传进入默认夹 |
| PATCH  | `/bookmarks/:id`                      | AuthRead | 把一条收藏移动到自己的其他收藏夹          |
| DELETE | `/bookmarks/:id`                      | AuthRead | 取消收藏（按收藏记录 ID）                 |
| GET    | `/moments/bookmarks?folderId=`        | AuthRead | 我的动态收藏；可按收藏夹筛选              |
| GET    | `/moments/bookmark-folders`           | AuthRead | 我的动态收藏夹分类与每夹收藏数量          |
| POST   | `/moments/bookmark-folders`           | Auth     | 新建动态收藏夹分类                        |
| POST   | `/moments/:id/bookmark`               | Auth     | 收藏动态；可选 folderId                   |
| PATCH  | `/moments/:id/bookmark`               | Auth     | 移动动态收藏                              |
| DELETE | `/moments/:id/bookmark`               | Auth     | 取消动态收藏                              |
| GET    | `/users/:id/moment-bookmarks`         | Optional | 用户公开的动态收藏                        |

## 核心业务规则

- 收藏列表仅返回当前用户仍可访问的已发布收藏：公开帖，或当前用户仍是成员的私密帖；按收藏时间倒序排列
- `GET /bookmarks` 每条返回完整主题帖列表卡片并附加 `bookmarkId` / `bookmarkFolderId`；卡片字段与首页一致，包含默认子贴、正文摘要、首张普通图片封面、标签及成员/玩家/楼层计数。不传 `folderId` 保持历史“全部收藏”语义
- 拆分迁移会把每个既有主题帖夹等 ID 复制为独立动态夹，动态收藏的外键改为只引用动态夹；新账号注册时在同一事务创建两套默认夹，两个服务层各自保留幂等补偿
- 自定义收藏夹名称 trim 后长度为 1–24 个字符；同一目录集内不可重名，但主题帖夹与动态夹可分别创建同名目录；分类和名称不通过公开用户收藏接口暴露
- `GET /bookmarks/folders` 只列主题帖夹，`bookmarkCount` 是该夹主题帖数量；既有 `momentBookmarkCount` 仅为旧客户端按同名动态夹聚合的兼容字段。新客户端必须从 `/moments/bookmark-folders` 读取动态夹及其 `momentBookmarkCount`
- 动态收藏列表按收藏时间倒序；本人列表附带 `bookmarkFolderId`，公开列表不返回任何私有归类信息
- 公开动态收藏与主题帖收藏共用 `showBookmarks`；同时排除已删除动态和当前查看者双向拉黑的作者
- 移动主题帖收藏只接受本人的主题帖夹，移动动态收藏只写入本人的动态夹，数据库外键也分别约束两类目录
- 公开帖：任何人都可收藏
- 私密帖：仅参与人可收藏（非参与人尝试收藏 → 404）
- 已收藏的帖重复收藏 → 409 Conflict
- 取消收藏时校验归属（仅允许取消自己的收藏）
- 公开用户收藏与本人收藏复用首页主题帖卡片投影；公开接口不暴露收藏记录 ID 或私有收藏夹 ID

## 设计决策

- **收藏与参与解耦**：收藏是用户主动行为（"我想常回来看看"），参与是被标记为玩家（"楼主认可我"）。两者独立
- **私密帖收藏强制校验**：防止用户通过邀请链接进入后收藏，之后被取消参与人身份仍能通过收藏入口访问
- **按收藏记录 ID 删除**：post 可被多次收藏，用记录 ID 精确定位，避免歧义
- **兼容默认分类**：`POST /bookmarks` 的 `folderId` 是可选字段，未升级客户端无需迁移即可继续收藏
- **兼容动态快捷收藏**：动态收藏请求体可省略；首次收藏进入默认夹，重复无参数请求保留已有分类
- **兼容旧共享目录客户端**：迁移保留既有目录 ID；旧客户端把主题帖夹 ID 传给动态收藏接口时，服务端只把它映射到同名动态夹，必要时懒复制目录。该兼容层不会让动态收藏引用主题帖夹；新客户端不得依赖此映射
