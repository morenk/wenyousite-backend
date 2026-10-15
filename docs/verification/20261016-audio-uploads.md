# 正文音频兼容后端候选验证

## 范围与来源

任务分支 `codex/20261016-audio-uploads`，基线 `b5f0e3bb0b99a3f9763b31e3080cb4d4f2e64045`。稳定 HTTP/Markdown 契约来源 `cb44acaeb7fbc735fb569276aef00435bf24efe5`，音频 fixture/schema 内容最后变更于 `509dba4aa7d63525eed082cddc0d99a461dc8bfe`；最终运行实现以本 PR HEAD 为准。没有合并、Tag、部署或系统依赖安装。

按本次负责人指示，未运行全量测试、全量分析、完整构建或门禁。PR HEAD 保留 `[skip ci]`，避免 pull_request 自动触发完整 workflow；授权合并后应恢复最终源码必要门禁，不把本候选当作已完成合并验证。

## 定向验证

- 最新结果覆盖 17 个直接相关 Jest suite：音频 AST、五格式真实转码、运行依赖、上传预算、引用、投影、worker、恢复、配置、meta，以及正文/草稿/子贴/主题/聚合/表情与既有展示投影调用。音频基础批次 7 suite / 85 项通过；新增安全与恢复最终批次 6 suite / 117 项通过。中间调用方批次中表情查询断言因新增用途/领取过滤失败，已更新精确查询预期并在最终批次通过，未放宽行为断言。
- 真实输入 MP3、M4A/AAC、WAV、OGG/Opus、FLAC；附图/标签剥离；伪造 MIME、损坏文件、网络播放列表、真实双音轨 M4A/活动视频 MP4 拒绝。真实 599.5 秒 FLAC 转码成功、600.1 秒拒绝；输出单 MP3 音轨 128kbps。
- 最终变更的 29 个 TypeScript 文件定向 ESLint 通过。两个 release shell 文件 `bash -n` 通过。OpenAPI 从源码重新生成与已提交契约无差异；五个 Web 消费者版本字段逐项一致。
- 固定归档在本任务忽略缓存全新离线解包，逐文件 SHA-256 与执行版本/编码器/解码器检查通过；错误归档拒绝，准备测试临时目录已删除。音频 fixture 通过 AJV 2020 schema（16 个正文 case、5 个无效投影 case）。
- 未执行需要 root 的 `assemble-backend-release.integration.test.sh`，也未执行 release 组装或服务切换。本次更新其隔离 fixture，实际管理身份权限/组装验证留待授权合并发布阶段。

## 独立写入与清理

唯一写入入口 `scripts/e2e-runner.ts --source --suite=audio`，不构建整站。每次使用 runner 新建 PostgreSQL、Redis、上传路径、随机账号，迁移由隔离 owner 完成，业务服务仅使用 `wenyousite_app`；真实邮件、推送、COS 均关闭。S3rver 使用本轮 uploads/audio 目录和随机 loopback 端口，公开 URL 为不会请求的 `audio.e2e.invalid`。

最终 runId `e2e_fa88c5bab6402ebb2f0992bd`：UID 1002，目录 `/tmp/wenyousite-e2e-a03W7d`，PG 33043、Redis 43407、API 41313，Redis instanceId `212acf6eec28ee0a9700820bb601c746c887b76d`。开始前实际 cluster_name、Redis instanceId/ownership 与 manifest 一致。

通过迁移、新增音频签名/上传/确认、BullMQ 成功和末次失败重试、原件删除、MP3/cache headers、对象 Range 206、引用持久化/去重、原引用保留、新借用他人音频拒绝且事务回滚、回收行锁与并发绑定拒绝、孤儿对象与记录回收、HTTP 未登录 401/已登录能力关闭 503、关闭时 meta 无能力。

最终输出 `resourcesCleaned=true`；另外两个同任务修订验证 runId `e2e_74ab7e200b5706dfee45fadd`、`e2e_8e74e6aa1fbe7310c0bfdcb9` 也完成清理。独立复核三个根目录均不存在、九个 API/PG/Redis 端口均关闭、本 checkout 私有登记目录为空。没有线上写验收或真实桶请求。

## 运行限制

固定运行资产仅支持 Linux x64/glibc，保留 LGPL 许可与源码/构建来源；Alpine Dockerfile 不在本批支持范围。音频入口默认关闭，启用必须明确配置并在 API/Worker 使用同一不可变 release。沿用公开图片对象语义，已知媒体 URL 不随帖子权限撤销。进程有时间、单分配、输入/输出和并发预算，没有总 RSS 硬上限。

Auto-review 默认偏好已传递；宿主无受支持的设置/核验入口，实际尚未设置/核验，`never` 不等于 Auto-review。

## 本地定向日志摘要

日志仅位于本任务忽略缓存，未提交运行数据：

- `.cache/audio-tests-3.log` SHA-256 `360e740f1d98ee18d41c53acfa774a8ec582de6e0b6af7c584a73540da355791`。

- `.cache/audio-callers-tests.log` SHA-256 `1dc22541c19629e34e019714e08e8b81c301a3f7079b6148a354842fb476de79`。

- `.cache/audio-final-targeted.log` SHA-256 `ec11a977aef6460df8a5b94b49c42e3a2ddae4cc93c030c96957ced50186d4cd`。

- `.cache/audio-integration-claim.log` SHA-256 `745c31365fc50fd538a900c9fb51db3598965f6f7f727e3633e11af93511e241`。

- `.cache/audio-encoder-final.log` SHA-256 `40c1b09297addce98ffe8a7f3cd9cb4dcafdba01bddc18247446b5fa3f83b400`（补充真实视频/双音轨拒绝后，编码器单 suite 全部通过）。
