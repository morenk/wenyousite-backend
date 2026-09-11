# 完整动画 WebP 展示契约

`display` 是经过验证并发布的完整展示资源，来源 `url` / `key` / MIME / size 保持兼容身份。所有 GIF 展示场景（正文、主题封面、详情、查看器、动态、评论、私信、头像及编辑预览）优先消费此资源；默认保存下载也使用它，文件名和 MIME 使用 WebP。编辑、引用、收藏、表情导入继续提交来源身份，不把展示 URL 写回 Markdown。客户端不得猜测对象键。

- `display = { url, contentType: "image/webp", width, height, bytes, animated, frameCount, durationMs, loopCount } | null`，兼容旧响应可省略。
- 静态图固定 `animated=false / frameCount=1 / durationMs=0 / loopCount=1`；动画返回已校验值，0 表示无限循环、1 表示一次。逐帧时长、帧数、透明合成及循环完整保留；完整动画产物保留输入单帧宽高，不能用列表预览冒充完整资源。
- 现有 `thumbnailUrl / feedUrl / mediumUrl / posterUrl / previewVariants` 仍负责适当尺寸和静止状态。新字段不改变主题封面可视多播、动态列表静止或其它播放门禁，也不强迫静态列表加载大图。主题动画按适当预览 → 完整 display 选择；详情、大图和正文使用完整 display。
- Media、主题封面、动态及评论、私信、表情均使用同形 `display`；用户摘要补充 `avatarDisplay`，背景各版本补充 `display`。已规范表情 WebP 不重复有损编码；历史元数据尚未校验时可为空。
- 帖子、主楼正文、楼中楼、草稿、个人历史回复等已授权返回正文对象携带 `mediaDisplays: [{sourceUrl, display}]`。映射只描述该对象真实 Markdown 图片节点中的精确来源，代码块不参与；未知外链不伪造映射。站内重复 URL 无法唯一对应时不宣布资产。未授权内容、删除内容、撤回私信不因映射重新暴露。返回字段缺少时按旧协议兼容，不调用本人上传查询 API 逐图解析。
- 新 GIF 只有在完整 WebP 成功上传、时序和尺寸校验后才进入 COMPLETED；转码失败进入既有有界重试和失败状态。可选 480/800 预览失败不影响已经成功的完整展示，但不能替代必需转码。完整产物即使比 GIF 大也不静默回退。
- 历史记录的 display 为空仅表示未完成补处理，兼容期间允许来源回退。补处理不把历史 COMPLETED 降级，不改内容身份，不删除原 GIF；默认 dry-run、有界分页、独立幂等尝试与失败补偿。生产补处理需要单独授权，未补齐前不得宣称历史全站已转换。
- 常规 Media 目前接受 GIF 动画，明确拒绝动画 WebP 和 APNG 输入；表情导入已有动画 WebP 支持。本轮不新增格式支持，拒绝格式不能静默首帧化。

发布顺序为兼容后端、消费者、经授权的历史补处理。来源兼容协议与原件清理不在本轮范围。

## 处理、重试与恢复

完整动画使用现有 Sharp/libvips/libwebp，按完整合成画布逐帧编码并写入 ANMF no-blend 容器。没有直接使用动画编码器的重复帧合并优化；输出再次验证单帧尺寸、帧数、每帧 delay 和 loop。表情保留既有 512px、120 帧、15 秒、120MP、4MiB 独立政策，规范动画 WebP 可直接读入此保帧路径；普通 Media 仍采用原 GIF 输入政策。

完整展示与可选列表预览在同一进程共用一个编码槽；完整子进程输入最多 10MiB、输出最多 32MiB，V8 堆 96MiB、RSS 512MiB 监测，排队与编码共用 60 秒截止时间，超时或超限 SIGKILL。子进程只接收编码所需的无密钥环境，且保留自己的退出看门狗。RSS 监测是事后采样，不等同于操作系统硬内存隔离；像素预算负责分配前约束。对象上传另有 30 秒截止和取消。

完整产物先登记精确随机 attempt key，再 PUT，最后事务 CAS 发布 display 与 attempt 状态。复用 `MediaPreviewAttempt` 的尝试账本，允许 key 白名单增加完整展示 key；原预览协议与 PUBLISHED 数据继续有效。落败或过期尝试按原墓碑退避清理，绝不把其它已发布尝试作为补偿目标。已引用来源 GIF 与其完整 WebP 一并保留。

`media_processing_complete` 增加 `displayMs` 和 `displayBytes`；历史成功/失败输出媒体 ID、耗时、字节、次数和固定 failureCode，不输出来源 URL 或密钥。新上传沿用有界队列重试及终态 FAILED；客户端查询仍为 PROCESSING 时保留 mediaId，可继续查询，不能仅因本轮等待到期就重复上传。

历史字段 `displayStatus / displayAttempts / displayStartedAt / displayFailureCode` 与原 MediaStatus 分开。累计最多三次尝试，五分钟租约可恢复中断；生产者 dry-run 默认每次最多 100 条、允许显式 1..1000，返回 nextCursor。重复 apply 使用稳定队列 ID，不重置累计上限。已耗尽项保留给人工审查，不自动无限转码。

```bash
pnpm media:display:backfill --help
pnpm media:display:backfill --limit 100
# 仅经批准后、使用受管理的应用运行配置入队；不会在此进程转码
pnpm media:display:backfill --limit 100 --after <mediaId> --apply
```

任务通过现有 image Worker 执行。执行记录应保留 dry-run / apply 输出及精确部署 SHA；不得把提供脚本等同于已经补齐历史资产。后台/头像/动态/私信/帖子/草稿的存活引用纳入扫描，未绑定孤儿不批量加工。

迁移只增加可空展示字段和尝试计数，不改原 URL 或主状态。回滚旧应用时保留新增列和已发布对象即可，旧应用继续读取来源字段；不用删除新资产或回滚历史正文。测试通过随机专属数据库与临时非 owner 角色验证迁移、DML、真实编码发布、并发 CAS、清理、事务回滚及授权引用映射，禁止连接生产端口。

## 验证证据边界

[重复帧跨解码器样本](../contracts/fixtures/media-display/manifest.json)固定 24×16 三帧红/红/蓝、300/600/600ms、循环两次，来源与 WebP 均保存 SHA-256。它用于原生解码器验收；不是压缩率或页面性能代表样本。

[合成子进程测量](media-display-performance.samples.json)记录四组不同尺寸/帧数，包括 100MP 和 300 帧边界。测量对应 JSON 内 encoder SHA-256；数据为单并发合成棋盘图，有并行仓库检查，进程树 RSS 包含 pnpm/tsx 包装，不是纯 decoder 内存或客户端性能。部分产物比 GIF 大，完整时序与 WebP 格式保证不能被表述为每张图必定省流量。实际最慢样本超过 20 秒，消费者需要支持继续等待处理完成。

历史 `contentType=null && animated=true` 也纳入候选，下载后仍由真实 GIF 检查确认。有效完整 display 可纠正主题封面的未知动画声明；缺 poster 保持占位，不猜路径，不因缺失静态首帧阻止符合可视条件的完整 WebP 播放。

孤儿回收与补转登记使用同一 Media 行锁串行：删除已领取时禁止新账本与 PUT。有效五分钟补转租约阻止领取；未发布上传至少完成一次补偿，并保留七天迟到 PUT 墓碑后才能随孤儿 Media 回收。删除失败保持账本，过期成功补偿允许有界恢复。
