# 开发隔离预览退役边界与设施盘点

本记录对应 2026-10-10（北京时间）的退役任务，只记录当次只读盘点；不作为未来运行状态事实源。最终源码 SHA、检查结果及跨仓库消费顺序以该任务 PR 和治理交付为准。

## 退役与保留范围

退役 Backend 持续会话、真实快照导出/发布、网关、四个功能样本脚本、私有 dev-preview-session v1 schema，以及下载网关的 HTTP 预览 Cookie 模式。旧 WENYOU_PREVIEW_*、PREVIEW_STATE_ROOT、PREVIEW_SNAPSHOT_ROOT、DOWNLOAD_PREVIEW_RUN_ID 或 E2E_RUN_ID=preview_… 配置须显式移除；不会静默回落到普通运行模式。

普通 watch / debug 入口继续可用。下载 Cookie 固定为 __Host-wenyou-download-device，Path=/、HttpOnly、SameSite=Lax、Secure；既有签名、配额、轮换和生产下载 URL 不变。S3 签名校验及回归移入 scripts/download-tests；PREVIEW_MAILBOX_DIR 仅作为 NODE_ENV=test 的测试收件箱保留。一次性 E2E 的数据身份、进程归属、清理与非 root 测试启动器继续维护。媒体动画缩略预览是产品功能，不在本次退役范围。

无业务 API、OpenAPI 或数据库迁移；无线上部署、服务重启、快照恢复或数据删除。原工具与私有协议可从退役前基线 a3849f2bb54aa497c21cdd0843cdd173ffbe4b70 追溯；[原运行说明](../archive/dev-preview.md)和[原消费者协议](../archive/dev-preview-session.md)保留。回滚须连同消费工具版本评审，不覆盖已有数据。

## 当次只读设施盘点

- 系统 systemd timer 列表 24 项、wenyou-dev 用户 timer 1 项，未见预览生成任务；该用户没有 crontab，/etc/cron.d 可见 e2scrub_all 和 sysstat。
- 可读 /etc/systemd/system、/etc/cron.d、/usr/local/bin、/usr/local/sbin 和该用户 systemd 目录中，未发现 dev-preview / preview-snapshot / dev:preview / wenyou-preview 入口引用。该范围没有遇到不可读文件。
- 13 个历史 session 的登记进程 group/start 与 /proc 逐项比对，均未发现匹配身份的存活进程。部分 session.json 仍记录 ready，这不是实际存活证明；没有修改这些记录。
- root crontab、root 私有配置与管理侧私有入口未核验；本任务没有 sudo 或管理身份操作，不能据以上结果断言所有管理设施已停用。

以下目录保留，未停止其他任务、未删除数据或卸载二进制：

| 精确路径 | 当次可见内容 |
| --- | --- |
| /home/wenyou-dev/.local/state/wenyousite-preview | 13 个历史会话目录 |
| /home/wenyou-dev/.local/state/wenyousite-preview-snapshots | 历史快照目录 |
| /home/wenyou-dev/.local/state/wenyousite-preview-backups | 历史下载预算备份 |
| /home/wenyou-dev/.local/state/preview-control-acceptance-20260926-01 | 空历史验收目录 |
| /opt/wenyousite/preview-tools | root 所有的旧预览二进制目录 |

历史 Worktree / 分支仍按各任务独立归属保留，尤其 /srv/wenyousite/worktrees/backend-live-preview 和 /srv/wenyousite/worktrees/backend-preview-control。后续回收必须核验精确路径、归属、必要数据与恢复材料，不由 E2E reaper 清理，也不因本次源码退役自动授权管理身份删除。
