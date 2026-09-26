# 移动端私有发布运维

Android 安装包由 Windows 开发机直接上传 RainS3，VPS 只校验公开对象、晋级 `/meta` 策略并公开后台已确认说明。APK、对象存储 AccessKey 和 Android SDK 均不进入 VPS。构建-only 无需后台说明；真实发版必须按下述两次校验流程执行。

## 受限通道与部署依赖

发布桶为 `wenyou-apk`，公开读前缀仅为 `mobile/android/*`；基址固定 `https://wenyou-apk.cn-nb1.rains3.com/mobile/android`。移动端保留原有构建、验签、SHA-256、上传及公网对象检查。

既有 `wenyou-release` SSH 用户只允许以下 sudo 命令，不增加任意命令或路径能力：

```text
wenyou-release ALL=(root) NOPASSWD: /usr/local/sbin/wenyousite-promote-android *
```

管理身份从已合并且通过门禁的后端提交部署时，现有部署脚本安装 [`promote-android-release.sh`](../scripts/promote-android-release.sh)。辅助 CLI 位于固定、root 所有、组/其他用户不可写的 `/var/lib/wenyousite/backend/current/dist/mobile-releases/mobile-release-cli.js`，Node 来自同一不可变 release。root 入口忽略调用方的路径、运行时、curl、跳过重启环境覆盖，清空 Node 子进程环境，并核对入口及祖先所有权/权限。它与部署共用 `deploy.lock`，不执行开发 checkout、可写依赖或用户指定 helper。

CLI 只解析 `/etc/wenyousite/backend.env` 的应用 `DATABASE_URL`，验证角色名为 `wenyousite_app`，不读取 migration owner 配置，不启动 Nest AppModule、定时器或队列。数据库表及辅助 CLI 必须先随后端兼容版本部署，再切换 Windows 发布工具。旧工具缺少 `--notes-revision` 会被拒绝。

本任务只提交源码和测试；安装受限入口、合并、部署和真实晋级均须独立授权。

## 构建前只读预检

超级管理员在后台确认精确 platform/versionName/buildNumber 的文案之后，Windows 通过原 SSH 通道运行：

```bash
sudo -n /usr/local/sbin/wenyousite-promote-android \
  --preflight --version 0.3.0-dev.36 --build 42
```

退出 0 的 stdout 为一行 JSON，没有文案、凭据或用户身份：

```json
{"schemaVersion":1,"platform":"android","versionName":"0.3.0-dev.36","buildNumber":42,"confirmedRevision":3}
```

预检以只读数据库事务执行，不修改说明、策略、历史、发布锁，不重启服务。缺少说明、身份不符、存在未确认编辑或未恢复发布锁均非零退出。调用方必须验证 schemaVersion、平台、版本名、build 和正整数 confirmedRevision，把结果绑定本次构建产物；不能静默重新接受不同 revision。

## 上传后的晋级

上传/公网对象检查通过后，在晋级前再次预检并与构建前结果精确比较。不同即停止，要求重新确认发布批次；然后携带相同 confirmedRevision 调用：

```bash
sudo -n /usr/local/sbin/wenyousite-promote-android \
  --version 0.3.0-dev.36 --build 42 \
  --url https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-0.3.0-dev.36-42.apk \
  --size 90900000 --sha256 '<64 hex>' --notes-revision 3
```

服务器再次锁定记录并核对版本/revision。仅客户端前置校验不足以替代此步骤。领取成功后，编辑与确认返回 409，直到成功或补偿完成；同 build 重试也执行说明与 APK 身份登记，不提前返回成功。

保留的对象检查包括严格 URL/文件名、Content-Type、Content-Length、immutable 缓存、attachment、application-id/version-name/version-code/SHA-256 metadata 和公开 `.apk.sha256` sidecar。禁止降 build；同 build 的已成功记录禁止改绑 URL、大小和摘要。普通发布只更新推荐构建，不自动提高最低支持构建；`/meta` 字段结构不变。

## 配置与数据库之间的一致性及恢复

root 私有 `/var/lib/wenyousite/.mobile-release.pending` 保存旧环境和 TSV 备份、随机 operationId。文件为应用环境的敏感恢复材料，不得输出、下载或提交。备份先写入临时目录并落盘后原子登记，环境替换在 `/etc` 同目录进行；持久数据库操作记录固定确认 revision 与 APK 身份。

状态流程：PREPARED 固定说明并锁定编辑 → 原子写策略、重启、核验 `/meta` 及本机/公网健康 → 原子登记 TSV → STAGED（仍不公开）→ COMMITTED（同事务写入公开快照，保留编辑锁）→ 公开详情读回核对版本/build/revision → SUCCEEDED 释放锁。后台文案确认本身不触发此流程。公开后无新 FCM，也不安排升级后弹窗。

任一步失败返回非零，恢复旧策略和 TSV、重新核验旧 `/meta`，撤销本次首次公开并释放锁；已有发布历史/已确认修正文案保留。数据库不可用时仍尝试恢复策略，保留恢复记录和锁，禁止报告成功。最后提交响应丢失时以持久 SUCCEEDED 判断已完成，避免重复补偿成功发布。

SIGKILL/断电不能依赖 shell trap。下一次晋级/撤回先恢复遗留操作；由于只读预检不能自动修复发布锁，也提供单独的受限恢复命令：

```bash
sudo -n /usr/local/sbin/wenyousite-promote-android --recover
```

该命令不接收版本、路径或任意命令，只恢复固定 journal 中的操作。成功 stdout 为 `{"schemaVersion":1,"recovered":true}`；它不构建、不上传、不晋级新版本。Windows 在中断后应提示运行恢复，再从只读预检重新开始，不能删除 journal 或手工改库解锁。恢复失败保留现场并非零退出。业务历史只取数据库公开快照；TSV 是运维登记，不能用它直接公开未提交文案。

## 撤回

```bash
sudo -n /usr/local/sbin/wenyousite-promote-android --withdraw
```

撤回同时清除 Android minimum/recommended/updateUrl，避免强制策略指向坏包；不删除说明历史或 RainS3 对象，不支持 Android 降级。失败同样补偿旧策略/登记，坏版本后续发布更高 build 修复。

## 验证

`pnpm test:mobile-release` 在本轮私有临时目录使用故障注入覆盖公开对象核验、revision 参数、同 build、策略/DB/公开读回/TSV 失败，以及 PREPARED/STAGED/COMMITTED 的 SIGKILL 与恢复。外部系统由测试替身提供，不安装系统脚本、不 sudo 或重启真实服务。

`pnpm test:integration:mobile-releases` 通过已登记独立 PostgreSQL/Redis runner 验证真实 Prisma 事务、Guard/CSRF、草稿不可见、并发、快照、持久发布锁和补偿幂等。完整交付还运行 `pnpm check` 与 `pnpm check:full`；真实发包不属于自动化测试。
