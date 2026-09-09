
# 主题帖列表动画预览

## 契约与兼容

`coverMedia.previewVariants` 在 API 5.20 兼容新增，为 optional + nullable 数组，最多两项 `{url,width,height,bytes}`，按实际面积升序。`coverMedia.url` 始终关联原 GIF，详情继续使用原件；posterUrl 是独立、保留原比例的静态首帧。coverImages 保留。

首页、搜索、公共/自有收藏、个人主页共用批量解析器，按精确正文首图 URL 一次查 Media；首页缓存使用 `shape:cover-media-v4`。仅可信已完成动画并有登记 poster 时返回有效预览。缺字段、null、未完成、外部图、重复或无效记录不能猜 URL。客户端按卡片实际绘制宽高乘 DPR 选最小够用档，否则最大档；旧动画无预览但有可信 poster 时可在单张播放调度下回退原 GIF。旧 GIF 缺 poster 保持占位。历史静态 JPEG/归一化 WebP 可用原静态资源作 poster，但尺寸可能大于旧 feed。本次不回填历史数据。

## 编码、预算与失败语义

- 原 GIF 保留，不新增详情转码，不开放动画 WebP 输入。
- 仅 RICH_CONTENT / LEGACY GIF 尝试预览：输入不超过 10 MiB、累计帧像素不超过 3200 万；原上传已有 2560px、300 帧、60 秒、1 亿累计像素政策不变。
- 长边 480 / 800px、inside 保留比例、不放大；q75、alphaQuality 100、effort 4。原图小于等于 480 时去重；每档只有比原文件更小时发布，不为硬体积目标强压。
- 保留完整时间线，不截短、不统一降帧。编码后校验帧数、每帧延迟和循环完全一致，不一致产物丢弃。透明与 GIF disposal 语义通过真实全帧解码回归。
- 基础原件和必需 poster 先上传成功。附加截止时间为 `min(开始优化+8秒, 最早任务开始+20秒)`；包括队列等待及 processingStartedAt，不足 1 秒跳过。编码槽、两档编码、数据库建账、两档 PUT 共用截止时间；PUT 使用 AbortSignal。发布事务的等待与执行也受剩余预算限制，余量不足 250ms 跳过发布。
- 预览编码、建账、对象存储或可选发布事务失败，不让基础合法上传变为 FAILED；事务回滚后仍尝试条件完成基础媒体。数据库整体不可用或原件/必需 poster 失败仍可能阻止基础完成，遵循原重试策略。
- Mobile 默认轮询约 30 秒，Web 上限 120 秒；不延长客户端超时。高队列年龄、过大/过长 GIF、编码超时、无缩小收益会缺预览并回退原有可信 GIF 路径，节流收益不对所有 GIF 统一保证。

子进程复用已有 Sharp/libvips/libwebp，无需新增 cwebp/gif2webp 部署依赖。单 Worker 编码槽为 1，V8 堆 96 MiB，预检累计像素，50ms 监测 RSS 超过 512 MiB 时 SIGKILL；RSS 为响应式监测，不是内核硬上限。execFile 以剩余时间超时并 SIGKILL，限制 stdout；子进程不继承数据库、对象存储凭据。

## 发布、重试与回收

PUT 前创建 MediaPreviewAttempt(PENDING)，保存确切 key。对象 key 含策略版本 v1、attempt UUID、尺寸；每次重试 UUID 独立，已发布 URL 不变。

发布在同一事务内 CAS PENDING → PUBLISHED（未过期）并条件完成 Media / 保存 JSON。清理以相同状态及读取时的 nextCleanupAt CAS 抢占 CLEANING。旧清理快照不能删除已发布尝试；旧尝试 key 不与新尝试碰撞。媒体完成 CAS 失败时在事务内恢复 PENDING。

原任务恢复后独立运行可选清理，异常只记固定告警，不跳过 stale 任务恢复。每十分钟调度、每批默认 20 条，按 (status,nextCleanupAt) 索引读取到期且基础媒体 COMPLETED/FAILED 的尝试。删除超时 2 秒，失败十分钟重试；成功也保留 CLEANING 墓碑，按 1/2/4/7 天退避复查，处理“404 后对象才迟到写入”，不假设有限等待后绝不会迟到。

墓碑有数据库存储及周期删除请求开销，随基础媒体最终回收清理。基础回收批量收集所有尝试 key，任何 key 删除失败均保留媒体/账目；对象成功删除后才删 Media 并级联账目。最终回收仍遵循原宽限期/引用领取机制，没有执行线上回收或删除旧媒体。

## URL 与缓存边界

正文媒体沿用当前已公开正式对象语义与 `public, max-age=31536000, immutable`，不修改 ACL、桶、域名或 CDN。原件不换 URL；预览发布后不变，无随机查询参数或续签。新编码政策须升级 key 版本，不覆盖缓存资源。私聊等其他用途不新增列表预览，不扩大访问权限。

## 构造样本与验收证据

Sharp 0.35.4 / libvips 8.18.6 / libwebp 1.6.0 本地构造文字界面、纹理动作、透明移动及小图 GIF，真实编码后比较 q70 / 75 / 80。这些均为构造样本，没有取得用户真实 GIF，不能宣称所有素材画质已覆盖。可复跑 `node scripts/benchmark-animation-previews.cjs /tmp/wenyousite-preview-benchmark`。

q75 字节比较（原始12帧样本 loop=3，帧延迟重复60/90/120/150ms）：

| 构造样本 | 原尺寸 / 原字节 | 480档 | 800档 |
| --- | --- | --- | --- |
| 文字界面 | 960×540 / 22168 | 480×270 / 9820 | 800×450 / 14408 |
| 纹理动作 | 960×540 / 3192902 | 480×270 / 150580 | 800×450 / 439490 |
| 透明移动 | 800×500 / 19631 | 480×300 / 28628，变大丢弃 | 800×500 / 16934 |
| 小动画 | 160×100 / 68780 | 160×100 / 12860 | 与480档相同，去重 |

文字 q70→80 的480档为9428→10898B；纹理134032→194088B，透明27992→30764B。q75 为可调整试验值，未采用更低质量强求体积。所有逐帧延迟和循环一致；透明移动 alpha MAE 为0；q75 PSNR 文字约45.86/47.72dB、纹理33.96/34.15dB。计时为一次本地测量，不是生产容量承诺。详见[测量 JSON](evidence/animation-preview-benchmark.json)。

输出目录 `*-comparison.png` 为选帧无损PNG：从上到下为帧0/4/8，从左到右为原GIF、q75长边480、q75长边800，均以300px卡片宽度对齐。原始 GIF、两档 WebP、单帧 PNG 和 quality-comparison.json 留在本地目录，未提交为业务资源。根任务目视文字/透明整体接近，纹理有细微差异；有限选帧不替代全帧回归。

回归覆盖真实全帧编解码（竖图300×900、透明、显式disposal2/3、不同帧时长、循环、逐帧 alpha/RGB 误差、小图去重、像素预算及无收益），真实子进程成功，以及 execFile 桩的 deadline/SIGKILL、RSS、槽超时不 spawn、释放后继续、输出边界。独立600ms短deadline烟雾观察到实际 SIGKILL，随后槽位可继续执行。

发布回归覆盖慢编码/建账、两档上传共享预算和 abort、存储失败基础完成、过期队列跳过、独立重试key、事务发布与清理CAS、事务失败回退。清理回归覆盖旧快照已发布不删除、404后迟到PUT再次删除、失败保留证据/退避、最终回收失败保留媒体、辅助清理异常不妨碍stale恢复。

迁移 `20260909140000_thread_cover_previews` 在完整旧基线加首帧迁移后的隔离 PostgreSQL17 临时库验证：2条历史记录 URL/poster 保留且预览NULL、JSONB读写、账目默认值与索引、媒体删除级联。迁移 SHA-256 为 `b69455ffa7a05973d9bef92607f3913504eaed4d34710e4838e0b7b33f567308`；验证SQL SHA-256 为 `5bd92a3c99ec38c008b1221eff8f2a218896c97a269713cb22811a7730c6c735`。无生产数据/凭据/端口，临时容器由治理任务管理并移除。

补充真实 PostgreSQL CAS 验证覆盖“发布先赢：发布1/清理0”“清理先赢：清理1/发布0”，以及事务回滚同时恢复 ledger 与 Media JSONB；结果为 preview_migration_cas_rollback_passed。验证 SQL SHA-256 为 `992c8d6ce8814f0fcf7f6d207ac5b9cafe607aba4030fc19ce775a2de7ff8b0b`，独立临时容器已确认无残留。
