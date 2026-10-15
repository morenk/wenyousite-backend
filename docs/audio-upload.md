# 正文音频 v1

音频沿用图片公开对象语义。帖子访问控制不撤销已知媒体 URL，不提供私密音频保证。

## 上传与能力

`GET /meta` 仅在明确开启配置且固定转码运行依赖经校验就绪时返回 `audioUpload`（version、maxBytes、maxDurationMs、contentTypes、outputContentType）；字段缺失时隐藏上传入口。服务端未就绪也拒绝音频上传，不仅依赖界面。使用既有 `/media/upload-url`、同 ID 重签、`/media/upload-done` 和 `/media/:id`；purpose 为 `RICH_CONTENT_AUDIO`。输入 MIME 为 audio/mpeg、audio/mp4、audio/wav、audio/ogg、audio/flac；别名由客户端规范到以上值，服务端核验真实内容。音频上限 30MiB、10 分钟，图片保持 10MiB；沿用每小时配额和 10000 字正文限制，不新增每篇音频个数限制。

上传状态仍为 UPLOADING → PROCESSING → COMPLETED/FAILED。未完成只在本地显示可取消占位，不写入持久正文。完成的 url、contentType、size 指向剥离标签与封面的 MP3 128kbps 播放副本；新增 durationMs。失败新增受控 failureCode：AUDIO_INVALID、AUDIO_TOO_LONG、AUDIO_PROCESSING_FAILED，不暴露工具 stderr。成功或最终失败清理 staging，不永久双存原件。

## Markdown 与读取

规范源码为独占顶层段落的普通无 title 链接 `[音频](URL)`；用户修改的 label 和 marks 保留。不增加 Markdown 版本、不使用自定义 title 或未知节点。旧端作为普通链接编辑、保存与点击；精确 fixture 见 [音频语料](../contracts/markdown-audio-v1-fixtures.json) 与 [schema](../contracts/markdown-audio-v1.schema.json)。

正文响应新增可选 `mediaAudios: {sourceUrl,mediaId,contentType,size,durationMs}[]`。只有本次已授权正文和真实媒体引用账本中的完成音频进入投影，按首次引用 URL 去重。新端仅将投影命中的顶层独立单链接段落显示为播放器；软换行、混排、列表与引用仍普通链接但保留账本。代码、反斜杠转义、外链及缺投影一律不升级。匹配精确 sourceUrl，不能靠扩展名猜测、拼接衍生地址或主动请求陌生 URL。链接重复不重复保留对象，label 可作为播放器标题与无障碍名称，不得丢失文字。

自己的完成音频可复用；编辑者可保留原内容已绑定资源，新增他人音频拒绝。草稿、正文、回复与主题正文同步引用，移除引用后沿用既有孤儿宽限期、回收领取锁及失败补偿。未完成、删除领取、用途不匹配资源不可绑定。

播放按需加载，不自动播放；列表用文字摘要，正文初始不请求音频字节。对象存储直接处理 Range/206，标准 MP3 固定 URL 使用 immutable 缓存，不通过业务 API 转发字节。发布顺序为兼容后端 → Foundation 声明/消费者 → 独立清理阶段；本批次不删除任何旧协议。
