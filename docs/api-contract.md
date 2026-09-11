# API 契约发布流程

## 事实源与优先级

1. `src/**` DTO、控制器装饰器与统一响应拦截器定义运行时和源 schema。
2. `contracts/openapi.json` 是经过评审、供 Web/Flutter 生成代码的固定契约产物。
3. `docs/api-endpoints.md` 与 `docs/error-codes.md` 是自动生成的人类索引。
4. 手写模块文档只解释跨请求流程和业务语义，不复制完整 schema。

若四者冲突，先修正运行时代码或装饰器，再重新生成产物；不得手工修改生成文件掩盖差异。

## 版本规则

- `MAJOR`：删除/重命名字段或端点、收紧必填、改变认证或响应语义。
- `MINOR`：向后兼容的新端点、可选字段、错误码或能力。
- `PATCH/dev`：文档、schema 精度和非破坏性修正。

每次契约内容变化必须更新 `API_CONTRACT_VERSION` 与 [`contracts/CHANGELOG.md`](../contracts/CHANGELOG.md)。`openapi:check` 会与 Git 中上一份冻结产物比较，拒绝同版本不同内容；运行时通过 `/api/v1/meta` 与 `X-API-Contract-Version` 暴露版本。

## 本地流程

```bash
pnpm contract:generate
pnpm docs:generate
pnpm openapi:check
pnpm docs:check
```

`openapi:check` 同时检查实时导出与已提交产物一致，因此忘记重新导出会直接失败。生成文件必须随实现提交；现有 Web 仓库通过同步脚本固定同一份字节内容，Flutter 仓库建立后必须采用等价门禁。

## OpenAPI 约束

- OpenAPI 3.0.x、稳定且唯一的 lowerCamel `operationId`。
- 每个操作显式标注 `public` / `optional` / `authenticated` / `appeal` / `admin` 认证模式。`appeal` 的两个 Bearer security requirement 是二选一。
- 每个成功响应引用具名 envelope component；分页 envelope 必含 `meta.cursor` 和 `meta.hasMore`。
- 错误统一为 `ApiErrorEnvelope`，业务代码只依赖 `BusinessErrorCode`。
- 每个响应显式声明 `X-Request-ID` 和 `X-API-Contract-Version`；显式 429 响应额外声明 `Retry-After`。
- 查询参数不允许空 schema，本地与生产 server 均显式声明。
- 未知响应字段必须被客户端忽略；可扩展枚举在客户端必须有 unknown fallback。

## 客户端消费

Web 与 Flutter 不直接下载线上 `/api/docs-json`。发布分支同步固定的 `contracts/openapi.json` 后再生成客户端，生成器版本也应锁定。生成结果的 diff 属于契约评审的一部分；出现非预期删除、nullable/required 变化或大量匿名模型时阻止合并。

移动端范围以 [`mobile-v1-operation-coverage.json`](../contracts/mobile-v1-operation-coverage.json) 为唯一覆盖清单，以 [`mobile-v1-golden-fixtures.json`](../contracts/mobile-v1-golden-fixtures.json) 固定跨端协议旅程。OpenAPI 中的全部 operationId 必须在生成清单中且仅分类一次；状态改为 `implemented` 时必须记录自动测试证据，手写文档不复制容易漂移的接口总数。

合同 `5.15.0-dev.20260902.1` 起，登录客户端可使用 `stickersImportMomentImage` 或 `stickersImportMomentCommentImage`，分别提交动态/评论 ID、`mediaId` 和稳定的 UUID v4 `clientRequestId`，并轮询既有 `StickerImportResponseDto`。Windows 移动端同步 `contracts/openapi.json` 后再生成客户端；父动态不可见按 `MOMENT_NOT_FOUND` 处理，评论来源不合法按 `STICKER_NOT_FOUND` 处理，VPS 不修改移动端生成物。

合同 `5.15.1-dev.20260903.1` 起，`/meta.markdownContractVersion` 声明为 `5`。Web 与已审查的移动端可为独立普通图片块写入左、中、右对齐标记；v4 客户端继续通过能力门控读写无图片对齐标记的兼容正文。

合同 `5.16.0-dev.20260903.1` 起，已发布主题帖的 OWNER/COLLABORATOR 可通过 `POST /threads/:id/export` 获取包含 Markdown 与 TXT 的同步 ZIP 档案；移动端暂不在本切片接入该能力。

合同 `5.16.0-dev.20260903.2` 起，导出档案使用分类展示名称、北京时间和“回复”层级文字；表情仅保留文字，不打包表情媒体。

合同 `5.16.0-dev.20260903.3` 起，导出请求可选择仅 TXT、仅 Markdown 或两者都要，默认两者都要。

合同 `5.16.0-dev.20260903.4` 起，导出 ZIP 及正文文件使用安全化后的帖子标题命名；Web 优先读取 UTF-8 `filename*`，中文标题可正确保存。

合同 `5.16.0-dev.20260903.5` 起，楼主和协作者可通过 `POST /posts/:id/pin` 与 `DELETE /posts/:id/pin` 管理所属子贴的主楼层置顶；每个子贴最多 10 条，楼层列表首屏优先返回置顶楼层，楼中楼不支持置顶。移动端需在 Windows 同步契约后接入。

合同 `5.16.0-dev.20260904.1` 起，签到的 `experienceAwarded` 在日活经验已由首次有效行为领取时返回 `0`；主题帖、私帖激活、楼层/回复、动态评论、获赞和打赏经验由服务端按北京时间分项限额、按不同互动用户去重，旧客户端无需新增接口或字段。

合同 `5.17.0-dev.20260905.1` 为导出增加 413/429 边界，媒体绑定发生回收冲突返回 409。既有请求形状和状态枚举保持兼容，Windows 客户端应提供重试提示，并统一“已完结”文案。

合同 `5.17.0-dev.20260905.2` 改变推荐排序策略，保持原有枚举、查询参数和分页形状；推荐缓存恢复失败返回 503，客户端沿用错误态与重试入口。

合同 `5.18.0-dev.20260905.1` 新增可选 `includeBody` 与响应 `kind`。默认 FLOOR 的字段和值保持原样，显式开启的 BODY 与原有楼中楼结果都允许空楼层号。搜索采用 OptionalAuth；匿名仍可用，有效身份按已有拉黑关系过滤，无效凭证遵循统一 401。双向隐藏是补齐已有权限承诺，沿用 404/403 错误 envelope；本切片以兼容的 5.x MINOR 演进，避免触发旧移动端仅支持主版本 5 的启动门控。Windows 跟进与验证证据见 [本轮交付记录](backend-hardening-20260905.md)。

### 普通回车与引用空行候选

2026-09-08 补齐单层引用中独占 `<br />` 的安全空行语义，HTTP DTO 与 Markdown v5 版本不变；非独占或带属性 HTML 继续拒绝。输入及阅读预期固定于 [回车语料](../contracts/markdown-editor-newline-v1-fixtures.json)。已有请求保持兼容；新引用空行的编辑需更新后的 Web 与 Android，双端结果仍待负责人验收。

普通正文对齐回车的输入规则修订为 newline v1 revision 2：Enter 新段恢复左对齐，自动折行保留整段对齐；继续使用现有 Markdown v5 段落边界和空段标记，HTTP DTO/OpenAPI 无变化。详见 [精确排版示例](modules/markdown-content.md#普通正文手动-enter-的对齐边界newline-v1-revision-2) 与 [Windows 同步说明](mobile-client-guide.md#revision-2-同步与-windows-验收)。


## 帖子列表封面播放读模型

HTTP 契约 `5.19.0-dev.20260909.1` 在所有主题帖列表卡片增加 `coverMedia`，保留 `coverImages`（最多一张）兼容旧客户端。首页（含推荐/最新等排序）、搜索主题帖、本人/公开收藏、用户创建/参与和本人协作主题帖均使用相同读模型。仅取可见默认主贴正文的第一张普通图片，跳过代码与站内表情；不改变既有权限过滤、排序和分页。

| 字段 | 含义 |
| --- | --- |
| `coverMedia: null` | 没有普通封面图片 |
| `coverMedia.url` | 与 `coverImages[0]` 相同的原始播放 URL，不意味着应立即加载 |
| `coverMedia.animated: boolean \| null` | 可信动画属性；无法确定时为 `null` |
| `coverMedia.posterUrl: string \| null` | 静止状态专用首帧静态图，无法确定时为 `null` |

新处理的 `RICH_CONTENT` / `LEGACY` 媒体增加 `_poster.webp`：固定第一帧、最长边 800、保持原比例且不放大小图；客户端按卡片布局裁切。不复用方形 thumbnail，通用媒体接口仍只暴露原有 thumbnail/feed/medium。Worker 在全部对象上传成功后与 `COMPLETED` 一起登记 `Media.posterUrl`；失败、重复领取和删除中记录不能提前宣布可播放，回收原媒体时同时删除 poster。

列表按精确原始 URL 去重并批量查询媒体，不逐条请求数据库或对象存储，不推断外链、签名参数或相似路径。无完成登记的历史 GIF 即使 `animated=false` 也返回 `animated=null, posterUrl=null`；历史 JPEG 或现有静态归一化 WebP 且 `animated=false` 可返回母版静态 URL。PNG 等无法证明为静态的旧记录保持未知。重复 URL、处理中、删除中或找不到的媒体同样保持未知。

消费者不得根据文件后缀判断动画，不得把未知 `posterUrl` 回退成原 GIF。缺字段的旧响应、未知或外部图片应展示占位并保留进入详情的操作，不在列表请求原图。已登记动画只有在停稳后选中时加载播放 URL，未选中只加载 poster。契约示例见 [共享语料](../contracts/thread-cover-media-v1-fixtures.json)。

新增 nullable 列与索引，无生产数据回填；匿名首页缓存使用新 shape 版本并拒绝缺少字段的旧缓存。兼容后端先上线，消费者随后；代码回滚保留新增列及已有对象，禁止通过删列回退。历史缺 poster GIF 的补生成另行评审。


### 可选列表动画预览（5.20）

`coverMedia.previewVariants` 为 optional + nullable，最多两项，每项仅含 `url`、单帧 `width` / `height` 及完整文件 `bytes`（均为正整数），按单帧像素面积升序。目标档位长边 480 / 800，不放大原图，同实际尺寸去重；只发布比原 GIF 更小且保留逐帧时长、循环与画面语义的有效动画 WebP。该字段不改变正文原图 `url` 或静态 `posterUrl`，不表示支持动画 WebP 上传。

客户端根据封面绘制宽高乘设备像素比，选择宽高均够用的最小档；没有够用档则取最大有效档。只允许中心选中的一张加载动画。旧服务省略字段或没有有效档返回 `null`，只有 `animated=true` 且独立 `posterUrl` 已确认的媒体可受控回退原图；未知/外部媒体仍只显示占位。预览加载失败同样先回静态首帧，避免无限重试或把所有候选原图预取。

预览是可选优化：基础原件与必需首帧先成功，再在共享截止时间内生成/上传变体；预算同时考虑队列等待及客户端处理窗口。超预算或优化失败不让基础上传失败。资源采用策略版本和独立尝试 key，发布后 URL 固定，沿用该媒体当前公开缓存语义，不改对象存储权限、域名或 CDN；原图与旧对象不删除。

失败补偿通过独立尝试账本记录精确对象 key；发布与媒体完成在同一事务内确认，清理先取得状态领取权，不能删除已发布或新尝试的资源。删除失败及可能迟到的对象仍保留重试证据，基础媒体最终回收包含所有尝试资源。契约兼容语料同时覆盖无该字段的前一阶段服务、null、单档和双档。

块边界 v1 将无前置空行的精确对齐标记作为顶层边界，组合预期见 [共享语料](../contracts/markdown-block-boundary-v1-fixtures.json)。HTTP DTO、错误码、OpenAPI 和 Markdown v5 均保持不变，无数据库迁移；错误行映射原始源码，不把解析分隔写入正文。
