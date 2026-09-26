# 移动端私有发布运维

Flutter 检查、正式签名、APK 验收与 RainS3 上传始终在 Windows 开发机完成。VPS 不接收 APK 或对象存储密钥，只在公开对象及已确认说明通过复核后更新 `GET /api/v1/meta` 的 Android 推荐构建号与下载地址。

## 安全边界

- 正式 keystore 与 `android/key.properties` 只保存在开发机，并做加密离线备份；禁止提交 Git 或上传 VPS。
- RainS3 使用独立桶 `wenyou-apk`，公开读只允许 `mobile/android/*`，禁止匿名写与目录列表。
- 发布桶专用 AccessKey 不得访问媒体桶；密钥只以当前 Windows 用户 DPAPI 密文保存，不进入 APK、Git、日志、命令历史或 VPS。
- VPS 使用无密码专用用户 `wenyou-release`。它只能通过 sudo 调用 `/usr/local/sbin/wenyousite-promote-android`，不能读取后端 `/etc/wenyousite/backend.env` 或执行任意 root 命令。
- SSH 主机密钥必须与 VPS 控制台的 ED25519 指纹独立比较；禁止使用 `StrictHostKeyChecking=no`、`accept-new` 或空 `known_hosts` 绕过校验。
- `Wenyou-Publish-Android.cmd` 只发布干净且 `HEAD` 等于上游分支的提交，防止无法追溯的本机代码进入安装包。
- Debug 构建固定使用 `site.wenyou.app.debug` 与“温油站 Debug”，不得再用调试或临时签名占用正式包名；真机上的正式包只允许由同一正式证书覆盖。

仓库内 [移动端 `tool/windows`](https://github.com/morenk/wenyousite-mobile/blob/dev/tool/windows/README.md) 只保存可审计程序。以下机器私有文件不进入 Git：

```text
%LOCALAPPDATA%\WenyouSite\release\rains3-credentials.json
%LOCALAPPDATA%\WenyouSite\release\release-config.json
%USERPROFILE%\.ssh\wenyou_release_ed25519*
android/key.properties
*.jks / *.keystore
```

## Windows 一次性安装

### 1. 创建专用 SSH 发布密钥

已有专用 ED25519 密钥可跳过。不要覆盖默认 `id_rsa`；自动发布密钥使用独立文件，私钥始终留在 Windows：

```powershell
ssh-keygen -t ed25519 `
  -f "$env:USERPROFILE\.ssh\wenyou_release_ed25519" `
  -C "wenyou-release@windows"
```

自动发布需要非交互 SSH，因此该专用密钥不设置口令；安装器会把私钥 ACL 收紧为当前用户与 SYSTEM。把 `.pub` 公钥安装到 VPS 的 `/home/wenyou-release/.ssh/authorized_keys`，不得复制私钥。

### 2. 安装本机工具和桌面入口

从移动端仓库根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File tool/windows/Install-WenyouReleaseTools.ps1
```

当 `.ssh` 中有多个 `wenyou_release_ed25519*` 私钥时显式指定：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File tool/windows/Install-WenyouReleaseTools.ps1 `
  -ReleaseKeyPath "$env:USERPROFILE\.ssh\wenyou_release_ed25519"
```

安装器执行以下可重复操作：

1. 从当前 Git 安装位置解析 Git Bash 与 OpenSSH，不固化仓库盘符。
2. 把版本化 PowerShell 工具复制到 `%LOCALAPPDATA%\WenyouSite\release`。
3. 写入只含本机路径的 `release-config.json`，不读取或覆盖 RainS3 凭据。
4. 保留现有 SSH 配置；缺少 `wenyou-release-vps` 时追加专用别名。
5. 在桌面安装 `Wenyou-Release-Setup.cmd` 与 `Wenyou-Publish-Android.cmd`。

仓库移动、Git 安装位置变化或工具升级后重新运行安装器即可。

### 3. 保存 RainS3 DPAPI 凭据

先撤销任何已暴露或不再使用的旧密钥，再创建权限仅覆盖发布桶前缀的新密钥。不要把新密钥发送到聊天或写入命令行参数；在隐藏提示中输入：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "$env:LOCALAPPDATA\WenyouSite\release\Set-RainS3Credentials.ps1"
```

脚本使用 `ConvertFrom-SecureString` 生成当前 Windows 用户绑定的 DPAPI 密文，并把文件 ACL 限制为当前用户与 SYSTEM。换机或更换 Windows 账号后必须重新输入；复制密文文件不能迁移凭据。

### 4. 核验 VPS 指纹与发布权限

在 VPS 控制台独立执行：

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

随后在 Windows 双击桌面 `Wenyou-Release-Setup.cmd`，粘贴控制台输出中的 `SHA256:...`。工具只有在网络扫描指纹与控制台指纹完全一致时才写入 `known_hosts`，然后以 `wenyou-release-vps` 执行只读预检：

```text
sudo -n /usr/local/sbin/wenyousite-promote-android --help
```

VPS sudo 权限必须精确为：

```text
wenyou-release ALL=(root) NOPASSWD: /usr/local/sbin/wenyousite-promote-android *
```

## 日常一键发布

发布前只需完成代码事实：

1. 在 `pubspec.yaml` 递增开发版本与 Android build，例如 `0.3.0-dev.39+45`。
2. 更新 `README.md` 与 `docs/CHANGELOG.md` 的版本记录。
3. 提交并推送当前分支，保持移动端仓库没有未提交或未跟踪文件。
4. 在后台为同平台/versionName/buildNumber 填写说明，由 SUPER_ADMIN 确认。
5. 双击桌面 `Wenyou-Publish-Android.cmd`，核对版本与源提交后输入 `y`。

桌面入口自动执行：

1. 读取 `pubspec.yaml` 的 versionName 与 versionCode。
2. 检查 Git 工作树为空且 `HEAD` 等于上游提交。
3. 在连接 VPS 前读取公网 `/meta`，强制核对本地契约版本、完整后端 revision、Markdown 版本，并拒绝低于当前推荐值的 build；同 build 重试必须绑定既有 APK 身份和确认 revision。
4. 通过下文受限 `--preflight` 校验后台说明，将 confirmedRevision 绑定本次构建；缺失或不匹配停止。
5. 运行唯一完整门禁 `npm run check`（含 OpenAPI 再生成、线上契约、架构/文档/API 覆盖、分析与完整测试），再构建正式签名 APK。
6. 校验 zipalign、签名、`site.wenyou.app`、版本和构建号。
7. 生成版本化 APK、`.apk.sha256` 与 JSON 构建摘要。
8. 上传 `wenyou-apk/mobile/android/`；同名对象内容不同则拒绝覆盖。
9. 通过 metadata、公开 HEAD、sidecar 与 manifest 复核公网制品。
10. 晋级前再次执行只读预检，精确比较构建前的版本身份和 confirmedRevision；携带 `--notes-revision` 经 SSH 晋级，再读取公网 `/meta` 和说明核验。

一次完整发布会运行全部测试和 release 构建，通常需要数分钟。窗口必须保持打开直到明确显示成功或失败；失败时不会跳过后续门禁。

## 手工分段与故障恢复

桌面入口不可用时，可从已安装工具显式选择阶段；版本默认读取 `pubspec.yaml`：

仅构建、验签并生成本地制品：

```powershell
& "$env:LOCALAPPDATA\WenyouSite\release\Invoke-WenyouAndroidRelease.ps1" `
  -Mode BuildOnly
```

上传并验证 RainS3，但不向用户推荐：

```powershell
& "$env:LOCALAPPDATA\WenyouSite\release\Invoke-WenyouAndroidRelease.ps1" `
  -Mode UploadOnly
```

完成构建、上传与 VPS 晋级：

```powershell
& "$env:LOCALAPPDATA\WenyouSite\release\Invoke-WenyouAndroidRelease.ps1" `
  -Mode Publish
```

底层 Git Bash 入口仍为 `tool/release-mobile-from-local.sh`。上传成功但 VPS 晋级失败时，对象保留为未广告制品；修复 SSH 或 VPS 后可幂等重试，同名同摘要对象不会重复覆盖。若发布中断留下锁，先执行下文受限 `--recover`，再重新预检；不要手工删锁或改库。BuildOnly 继续无需后台说明。

固定对象参数为：

```text
endpoint=https://cn-nb1.rains3.com
region=auto
bucket=wenyou-apk
prefix=mobile/android
publicBaseUrl=https://wenyou-apk.cn-nb1.rains3.com
Content-Type=application/vnd.android.package-archive
Cache-Control=public, max-age=31536000, immutable
```

## 撤回、强制升级与密钥轮换

坏版本先在 VPS 撤回推荐策略，再以更高 build 发布修复；不覆盖 RainS3 对象，不降低 Android versionCode：

```bash
sudo -n /usr/local/sbin/wenyousite-promote-android --withdraw
```

撤回会清除 Android `minimumSupportedBuild`、`recommendedBuild` 与 `updateUrl`，停止新的更新提示，但不会删除已上传对象。普通发布只更新 `recommendedBuild`；提高 `minimumSupportedBuild` 必须由维护者单独评估，不能由桌面入口自动决定。

RainS3 密钥轮换顺序：先创建最小权限新密钥，在 Windows 重新运行 `Set-RainS3Credentials.ps1` 并完成一次 `UploadOnly`，确认成功后撤销旧密钥。SSH 私钥轮换时先把新公钥加入 VPS，重新运行安装器与 SSH 初始化验证，再删除旧公钥。

## 客户端更新行为

- 客户端在启动和回到前台时读取 `/meta`；推荐横幅显示摘要并可进入完整内容，强制页显示完整说明；设置与游客入口提供已发布历史。说明读取失败可重试，不破坏启动/强制升级；不在升级后自动弹窗。
- Android 在下载前核对 RainS3 类型、长度、应用 ID、版本和 SHA-256，再以 `.part` 下载到 cache 并计算摘要；只有验证完成的文件才交给原生安装桥。
- 原生桥在打开系统安装器前再次验证包名、目标构建和当前应用签名；对象校验、HTTPS、客户端哈希与 Android 包校验共同保护发布链路。
- FCM/APNs 不传输 APK。VPS 在数据库保存版本说明及发布状态，并在 `/var/lib/wenyousite/mobile-release-history.tsv` 保存运维晋级登记，不保存安装包。
- 旧对象暂不自动删除；设置生命周期策略前必须确认对象没有仍被 `/meta` 引用。

## 后端确认、晋级与恢复协议

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
