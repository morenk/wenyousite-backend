# 正文音频 v1

音频沿用图片公开对象语义。帖子访问控制不撤销已知媒体 URL，不提供私密音频保证。

## 上传与能力

`GET /meta` 仅在明确开启配置且固定转码运行依赖经校验就绪时返回 `audioUpload`（version、maxBytes、maxDurationMs、contentTypes、outputContentType）；字段缺失时隐藏上传入口。服务端未就绪也拒绝音频上传，不仅依赖界面。使用既有 `/media/upload-url`、同 ID 重签、`/media/upload-done` 和 `/media/:id`；purpose 为 `RICH_CONTENT_AUDIO`。输入 MIME 为 audio/mpeg、audio/mp4、audio/wav、audio/ogg、audio/flac；别名由客户端规范到以上值，服务端核验真实内容。音频上限 30MiB、10 分钟，图片保持 10MiB；沿用每小时配额和 10000 字正文限制，并受下文音频准入预算约束，不新增每篇音频个数限制。

上传状态仍为 UPLOADING → PROCESSING → COMPLETED/FAILED。未完成只在本地显示可取消占位，不写入持久正文。完成的 url、contentType、size 指向剥离标签与封面的 MP3 128kbps 播放副本；新增 durationMs。失败新增受控 failureCode：AUDIO_INVALID、AUDIO_TOO_LONG、AUDIO_PROCESSING_FAILED，不暴露工具 stderr。成功或最终失败清理 staging，不永久双存原件。

## Markdown 与读取

规范源码为独占顶层段落的普通无 title 链接 `[音频](URL)`；用户修改的 label 和 marks 保留。不增加 Markdown 版本、不使用自定义 title 或未知节点。旧端作为普通链接编辑、保存与点击；精确 fixture 见 [音频语料](../contracts/markdown-audio-v1-fixtures.json) 与 [schema](../contracts/markdown-audio-v1.schema.json)。

正文响应新增可选 `mediaAudios: {sourceUrl,mediaId,contentType,size,durationMs}[]`。只有本次已授权正文和真实媒体引用账本中的完成音频进入投影，按首次引用 URL 去重。新端仅将投影命中的顶层独立单链接段落显示为播放器；软换行、混排、列表与引用仍普通链接但保留账本。代码、反斜杠转义、外链及缺投影一律不升级。匹配精确 sourceUrl，不能靠扩展名猜测、拼接衍生地址或主动请求陌生 URL。链接重复不重复保留对象，label 可作为播放器标题与无障碍名称，不得丢失文字。

自己的完成音频可复用；编辑者可保留原内容已绑定资源，新增他人音频拒绝。草稿、正文、回复与主题正文同步引用，移除引用后沿用既有孤儿宽限期、回收领取锁及失败补偿。未完成、删除领取、用途不匹配资源不可绑定。

播放按需加载，不自动播放；列表用文字摘要，正文初始不请求音频字节。对象存储直接处理 Range/206，标准 MP3 固定 URL 使用 immutable 缓存，不通过业务 API 转发字节。发布顺序为兼容后端 → Foundation 声明/消费者 → 独立清理阶段；本批次不删除任何旧协议。

## 固定运行依赖

运行依赖清单为 `audio-runtime.lock.json`，固定 FFmpeg 8.1.3 分支的 BtbN 月末 LGPL 构建、源码来源、归档与两个可执行文件 SHA-256。来源为 [FFmpeg 官方下载页](https://ffmpeg.org/download.html)列出的 [BtbN 构建](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08)。Linux x64/glibc >=2.28；不复用浮动 latest、不使用过时 npm wrapper 的联网安装脚本。`LICENSE.txt` 与二进制一起保留，固定外部进程使用，不链接到 NestJS。

开发者执行 `python3 scripts/prepare-audio-runtime.py`，或用 `--archive /path/to/archive` 指定已经下载的同一发行包。只写当前 checkout 的 `.cache/audio-runtime`；不安装系统软件、不修改 PATH。归档和逐文件哈希必须匹配，拒绝链接或越界归档。离线 release 组装要求该缓存存在，将核验文件和许可复制到自身 `tools/audio-runtime`；切换前由服务身份验证平台、哈希、执行版本、编码器与所需解码器。准备/检查只处理本地文件和子进程，不连接业务数据库、队列或存储。

`AUDIO_UPLOAD_ENABLED=false` 为默认；管理员在经批准部署的运行配置中明确开启后，API/Worker 启动时才核验运行依赖。默认目录为 release 内 `tools/audio-runtime`；开发可显式设 `AUDIO_RUNTIME_DIR` 指向本 Worktree 缓存。缺失或损坏时 `/meta` 不返回能力，音频签发/重签/确认返回 HTTP 503，既有图片继续工作。运行时不下载，不从共享 PATH 找编码器。API 与 Worker 必须消费同一不可变 release 和配置；现有 Dockerfile 是 Alpine，不能直接塞入此 glibc 资产，本批次仅支持实际宿主发布拓扑。

Worker 子进程仅允许本地 file/pipe 与5种容器，真实探测要求恰好一个音轨；可附封面但拒绝活动视频/字幕/数据流。编码只映射音轨，移除附图、章节和标签。输入30MiB、输出10MiB、时长10分钟，探测10秒、编码90秒、音频并发1；任何失败不暴露 stderr。临时工作目录 finally 清理；输出成功后仅发布MP3副本并删除staging。失败/重试/队列丢失沿用稳定mediaId和条件更新。

转码进程单并发，探测 10 秒、转码 90 秒超时，单次分配上限 64 MiB，输出限制 10 MiB。单次分配限制不是总 RSS 硬上限；本实现没有设置进程总 RSS 硬上限，部署方可通过现有 Worker 的 systemd 资源策略另行约束；本任务不修改 unit。

## 音频准入预算（5.38.0-dev.20261017.1）

保持30MiB输入、600秒、128kbps MP3和10MiB输出不变。默认每用户活动2份、UTC日新签发输入预留300MiB，分别配置 `AUDIO_MAX_ACTIVE_UPLOADS` / `AUDIO_DAILY_INPUT_BYTES`。日额度只在新mediaId准入时按声明输入大小预留一次，不按转码后的size累计；失败、过期不返还日额度，同mediaId重签/确认/队列重试不重复收费。日界按UTC；这是新音频的准入预算，不是对象存储实际PUT流量计量，无法阻止同一有效签名重复上传。

活动包含PROCESSING和有效UPLOADING租约。UPLOADING租约15分钟（签名10分钟加5分钟确认宽限），过期释放名额但不删除对象；同mediaId晚确认/重签需原子重新取得名额。完成/失败释放名额，PROCESSING不凭时间释放，仍由队列恢复处理。签发HTTP429的业务码：42901 AUDIO_ACTIVE_LIMIT（保留媒体稍后恢复）；42902 AUDIO_DAILY_BYTES_LIMIT（UTC次日可新建）。原42900小时配额保持。旧端保留通用429提示，新端可展示服务端简短message；429不得直接丢弃已上传文件或创建新mediaId自动重试。成功响应及Markdown协议不变。

预算与记录写入使用同一PostgreSQL事务和用户行锁；租约续签/确认与回收复用Media行锁。历史缺省字段兼容：旧UPLOADING/PROCESSING输入可从原始size计量，已转码记录无法还原输入，不伪造历史累计；上线前已完成音频不追溯计费。24小时旧上传回收必须同时确认租约过期；7日失败/完成孤儿宽限和完成回收开关保持。
