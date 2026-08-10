# 移动端私有发布运维

Android 安装包由 Windows 开发机直接上传 RainS3，VPS 只校验公开对象并晋级 `/meta` 版本策略。APK、对象存储 AccessKey 和 Android SDK 均不进入 VPS。

## 分工与事实源

- 发布桶：`wenyou-apk`，公开读前缀仅为 `mobile/android/*`。
- 固定公开基址：`https://wenyou-apk.cn-nb1.rains3.com/mobile/android`。
- 移动端仓库负责构建、验签、SHA-256、上传和公网对象复核。
- 后端 [`promote-android-release.sh`](../scripts/promote-android-release.sh) 只接受版本、构建号、URL、大小和摘要，不接收 APK。
- `GET /api/v1/meta` 的 JSON 结构不变，仍从 `MOBILE_ANDROID_*` 环境变量读取策略。

## VPS 一次性配置

后端由 `wenyousite-backend.service` 托管。创建无密码 `wenyou-release` 用户并配置开发机 SSH 公钥，然后安装受限 sudo 规则：

```text
wenyou-release ALL=(root) NOPASSWD: /usr/local/sbin/wenyousite-promote-android *
```

该用户不能读取后端 `.env`、写对象存储或执行任意 root 命令。RainS3 发布 AccessKey 只保留在开发机。

晋级脚本执行以下检查：

1. URL 必须严格匹配 `https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-<version>-<build>.apk`。
2. HEAD 的 Content-Type、Content-Length、immutable 缓存、attachment 和 `x-amz-meta-*` 必须与开发机构建一致。
3. 公开 `.apk.sha256` sidecar 必须匹配待晋级摘要。
4. 构建号不得降低；同一构建号不得改绑 URL。
5. 原子更新 `.env`，重启后端并验证本地/公网健康与 `/meta`；失败自动恢复旧配置。

VPS 只在 `/var/lib/wenyousite/mobile-release-history.tsv` 保存小型发布历史，不保存安装包。

## 日常发布与撤回

移动端开发机发布工具上传成功后调用：

```bash
sudo -n /usr/local/sbin/wenyousite-promote-android \
  --version 0.3.0-dev.36 \
  --build 42 \
  --url https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-0.3.0-dev.36-42.apk \
  --size 90900000 \
  --sha256 '<64 hex>'
```

普通发布只更新推荐构建，不自动提高最低支持构建。坏版本先撤回策略，再发布更高 build 修复：

```bash
sudo -n /usr/local/sbin/wenyousite-promote-android --withdraw
```

撤回会同时清除 Android minimum/recommended/updateUrl，避免旧的强制升级策略指向失效地址；不会删除 RainS3 对象，也不支持 Android 降级。
