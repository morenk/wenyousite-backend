# 日常开发与自动化验证

日常开发不要求每日真实数据快照、专用隔离预览后端、consumer.json 或会话控制器。按本次目标选择并配置普通调试入口；Backend 在 VPS 工作区运行，Web / Flutter 按各自仓库说明启动或复用开发进程。

在当前任务 Worktree 安装依赖并生成 Prisma Client 后，使用 `pnpm start:dev` 启动 Nest watch；需要断点时使用 `pnpm start:debug`。数据库、Redis、邮件、对象存储及监听端口由当前开发环境明确配置，不占用其他任务或已部署服务端口。源码调试无需合并或部署；进程归属记录任务与 Worktree 即可，不需要私有预览协议。公网运行拓扑和服务配置仍以[架构说明](architecture.md)与[数据库运维](database-operations.md)为准。

开发体验调整不放宽自动化数据边界：公网自动化只读；所有写入 E2E 使用[一次性独立资源](e2e-isolation.md)，核验身份后运行，结束按 runId 清理，不连接日常开发数据库。`PREVIEW_MAILBOX_DIR` 名称暂保留作为测试邮件收件箱配置：仅在 `NODE_ENV=test` 生效，现由管理员 E2E fixture 使用，并非持续预览入口。下载测试继续使用独立 UDS、私有对象存储、随机目录与合成 APK；`scripts/run-unprivileged-tests.cjs` 继续负责非 root 身份和临时目录清理。

交互式隔离预览工具、快照生成入口、私有 dev-preview-session v1 协议、四个功能样本脚本及下载网关 HTTP 预览 Cookie 模式已经退役。下载 Cookie 始终带 Secure，旧 `DOWNLOAD_PREVIEW_RUN_ID` 配置会被拒绝。Backend / Worker 启动同样拒绝旧 `WENYOU_PREVIEW_*`、`PREVIEW_STATE_ROOT` 与 `PREVIEW_SNAPSHOT_ROOT`，也拒绝旧 E2E_RUN_ID=preview_… 持续会话身份；需显式删除旧环境设置后使用普通开发配置。没有删除业务 API、数据库结构或已发布客户端兼容协议，OpenAPI 无须变更；Foundation 的预览专用说明随消费端同步退役。

[原开发预览说明](archive/dev-preview.md)和[原消费者协议](archive/dev-preview-session.md)仅为历史追溯。既存预览状态、数据库、上传目录、快照、备份和旧 Worktree 均保留；本次源码退役不停止其他任务或清理数据。若之后需要回收，须单独核验所属任务、进程、恢复材料与精确路径，不能交给 E2E reaper。必要时可从退役前 Git 提交恢复对应工具后再评审操作，不以重新启用旧工具作为日常开发要求。

本次代码退役后的保留目录及管理侧未核验范围见[只读设施盘点](evidence/dev-preview-retirement.md)。
