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
