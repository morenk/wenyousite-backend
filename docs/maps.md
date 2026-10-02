# 城镇与室内地图契约 v1

地图生成在 Web Worker 完成；API 只接受受限 JSON 几何，不接受 HTML、脚本、图片 URL 或外部资源。机器事实源是 `contracts/map-v1.schema.json`、`contracts/map-published-v1.schema.json` 及 OpenAPI。文本字段均为纯文本，客户端必须按文本渲染，不能作为 HTML、CSS 或 Markdown 执行。

## 数据与接口

地图身份 `id` 同时是 `mapId`；草稿 `version` 是乐观锁，首次为 1，每次保存递增。发布 `version` 为独立连续编号，不等同草稿版本。`POST /maps/drafts` 接收 `{clientRequestId:UUIDv4,document}`；`PATCH /maps/drafts/:id` 接收 `{version,document}`；`GET /maps/drafts/:id` 仅本人读取。`GET /maps/drafts?offset=0&limit=20` 返回 `{items,total,offset,limit}`，默认 20、最大 50；列表返回摘要而不是几何。`DELETE /maps/drafts/:id?version=N` 软删除草稿，不改变已发布版本。

`POST /maps/drafts/:id/publish` 接收 `{version,threadId,clientRequestId:UUIDv4}`，返回 `{mapId,version,threadId,document,createdAt}`。发布者必须拥有地图并具有主题管理权限。首次发布永久锚定同一主题；发布地图是将白名单内容显式公开给该主题当前有权阅读的用户，不会自动发布关联的私有草稿。草稿本身仍只有所有者可读取。`GET /maps/:mapId/versions/:version` 使用 OptionalAuth，读取前复用主题当前可见性、软删除、成员和双向拉黑策略。图层隐藏是 UI 行为，不是权限措施。

`GET /maps/templates` 返回版本化模板描述（id、kind、version、name、styles）；所有业务 API 均复用成功 envelope，列表是普通具名集合而不是 cursor 分页。

## 内容边界

生成器、模板和完整几何一起保存；服务端不依靠新算法还原旧版本。对象 ID 稳定，关联只允许已存在且正确类型的 ID；features 的 floorId/regionId/roomId/connectsTo 必须解析。城镇不含楼层；室内至少一层且所有 feature/marker 必须标注有效楼层。坐标在画布内；房间/建筑等多边形至少 3 点，门窗道路等线段至少 2 点。整个 document JSON 不超过 3 MiB。

发布会完全剔除 hidden feature/marker、locked、parameters；引用隐藏对象的连接一并剔除。被隐藏房间中的家具/门窗/标记必须一起隐藏或移除，不允许仅遮盖后仍把私有几何下发。楼层名称均视作公开内容。描述字段本身是发布信息，未公开笔记不得混入描述。

`feature.interior={mapId,version}` 仅用于 town 的 building，目标必须是相同主题下已有的室内发布版本。只发送固定版本，不存在“latest”跳转；目标读取仍逐次核验权限。禁止跨主题权限传播和 town/interior 循环。draft 删除不撤销快照；主题隐藏、软删除和成员失效立即影响读取。

## Markdown 与客户端

嵌入是普通 Markdown 链接：`[地图：青石镇](/maps/<mapId>/versions/<version>?threadId=<threadId>)`。这是 map-reference-v1，正文 Markdown 版本不变。Web/Mobile 精确识别路径并用授权读取结果生成封面卡，未识别的旧客户端显示普通链接。title/URL 不得充当权限依据。正文可以包含不可访问的链接，但阅读器只显示不可用占位，不泄露名称或几何。新版本不会重写旧帖子正文。

Mobile WebView 保持与 Web 同源的 viewer route，授权由应用受控消息通道注入内存；token 不进 URL、日志、HTML 产物、localStorage 或帖子。不新增绕过 API Guard 的鉴权端点；所有版本读取继续使用现有 Bearer。加载未信任页面或导航离开 viewer 时不得发送 token。

## 并发与错误

创建/发布以调用者及 clientRequestId 幂等，payload 不同返回 409 / IDEMPOTENCY_KEY_REUSED；相同 payload 返回原资源。版本过期返回 409 / OPTIMISTIC_LOCK_CONFLICT。非法 schema/悬空连接/尺寸超限返回 400；无权读取统一 404；非主题管理者发布为 403；缺身份 401。CAS 保存与发布事务串行锁定地图，失败不得产生半个版本。读取响应禁止共享缓存。

## 验收

覆盖 schema 白名单、隐藏传递、同主题室内链接、图层与版本稳定；真实隔离 PostgreSQL/Redis 覆盖迁移、并发保存、幂等发布、软删除、私帖/拉黑拒绝与权限变化。自动测试仅运行本次 e2e runner 资源；交互预览使用独立 dev:preview 批次。
