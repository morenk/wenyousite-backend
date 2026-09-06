# 移动端诊断接入审查（2026-09-06）

## 提交与契约

| 对象 | 已核实状态 |
| --- | --- |
| 移动端审查提交 | `36ef5c2aa4832c7db8a1b5ee3c55908a22363d0c`，`dev`，按规则快进同步后工作树干净 |
| 移动端固定来源 | 后端 `80e9820b06d3f7cbea209e11d2b7be5353add0a5`，契约 `5.17.0-dev.20260905.2` |
| 后端审查时分支头 | `6f075bfe405025d75c9566bd591ef8d96e5c07dc`，`dev`，与远端一致且工作树干净 |
| 本机及公网运行提交 | `8ea511a4fa16341b9d1bb7aee7e7c2c66b89f9fb`，来自 `/api/v1/meta.buildSha` |
| 本机及公网 API 契约 | `5.18.0-dev.20260905.1`，Markdown v5 |
| Web 固定契约 | `5.18.0-dev.20260905.1`，与后端及运行提交的 OpenAPI 逐字节一致 |

审查时四个仓库均无已有差异：后端、Web、移动端在 `dev`，Foundation 在 `main`。本次只补充后端接入说明；无需新增诊断接口、修改业务实现或更改契约版本。VPS 未修改移动端源码、配置或生成产物，未执行移动端测试、构建或发布。

## 兼容性结论与服务端验证

`36ef5c2` 的新增诊断使用既有 API、错误 envelope、请求编号和契约响应头；发帖与媒体接口没有新增必需字段。客户端支持 API 主版本 5、Markdown v3/v4/v5，因此启动能力检查兼容现行后端。5.18 相对该版本的 API 增量集中在搜索；服务端省略 `includeBody` 时仍只返回 FLOOR，旧模型可忽略新增 `kind`。

本机与公网分别只读验证以下四条路径，共八次 HTTP 请求，均通过：

| 请求 | HTTP / 业务码 | 关联验证 |
| --- | --- | --- |
| `GET /api/v1/meta` | 200 / 0 | 客户端 UUID 原样回传并出现在后端日志 |
| `GET /api/v1/threads?limit=invalid` | 400 / 40000 | 同上，错误 envelope 保持 `data=null` |
| `GET /api/v1/users/me`（匿名） | 401 / 40100 | 同上，拒绝未认证读取 |
| 不存在的 API 路由 | 404 / 40400 | 同上，统一错误 envelope |

八条响应均带 `X-API-Contract-Version: 5.18.0-dev.20260905.1`；异步日志写出后全部请求编号可匹配。另已核实本机/公网健康 200、数据库与 Redis 为 up。未制造公网 5xx、批量限流或写入业务数据；本记录不代表手机真机或 Sentry 收件验收。

## Windows 契约同步待办

移动提交说明中的“本地 5.17／公网 5.16”已不是当前状态；现在是移动端 5.17／公网 5.18。门禁 `tool/verify_production_api.dart` 同时要求 API 版本与后端 SHA 精确相等。现有 `tool/sync_backend_contract.ps1` 总是取 `origin/dev`，而后端纯文档提交按规则不部署，直接同步分支头仍会被 SHA 差异阻挡。

1. 在 Windows 给现有同步脚本增加显式提交选择（例如 `-Revision`），保留 fetch；校验提交存在且是 `origin/dev` 的祖先，所有 `git show` 导出及 `backendRevision` 使用同一 SHA。补充“部署提交落后于文档分支头”和“拒绝非远端祖先提交”的发布工具测试。后端参考镜像只做 Git 读取，不切换或修改工作树。
2. 读取公网 `/meta` 并以其实际 `buildSha` 同步。审查时目标为 `8ea511a4fa16341b9d1bb7aee7e7c2c66b89f9fb`；若公网已前进，重新审查该提交。从该提交导出完整契约与 fixtures，运行 `npm run api:generate`，同步覆盖清单和模块文档。不要手工改 `backendRevision` 或放宽现有门禁。
3. 5.18 的公开搜索支持可选认证，但该移动版本的搜索仓库仍传 `ApiRequestPolicy.public`（`skipAuth=true`）。Windows 需让已登录搜索携带现有会话，匿名仍可用；否则搜索按匿名视角返回，无法应用当前账号的双向拉黑过滤。同步后补充已登录/匿名搜索及拉黑场景验证。
4. 按 [既有兼容审查](./backend-hardening-20260905.md) 完成拉黑缓存失效、不可访问错误态及状态文案；BODY 搜索仅在实现 `kind` 分支和正文定位后开启。继续处理导出 413/429、媒体绑定 409 和搜索/推荐 503。
5. 运行 `npm run api:verify:production`、`npm run check`；全部通过后按移动端规则提交、推送并构建。门禁前后确认部署 SHA 未变化。本地 Markdown 基础 fixture 元数据为 v4，应用另支持 v5 图片扩展，不能为追平 `/meta` 而把基础 fixture 版本改成 5。

## Windows Sentry 配置与验收

审查时 VPS 的后端 DSN 为空，未取得独立移动端项目 DSN；远程上报尚未启用或验证。客户端 DSN 来自 Sentry 项目的 Client Keys (DSN)，见 [Sentry DSN 说明](https://www.sentry.help/en/articles/13964441-what-is-a-sentry-dsn)。不使用后端项目代替移动端项目，不把管理员 Token 放入 APK。

在 Windows 仓库外保存 `%LOCALAPPDATA%/WenyouSite/release/diagnostics.json`，内容仅为 `{"SENTRY_DSN":"<独立移动端项目的 HTTPS DSN>"}`。正式构建沿用已有入口，并在启动它的同一进程设置：

```powershell
$env:WENYOU_DIAGNOSTICS_CONFIG = (Join-Path $env:LOCALAPPDATA 'WenyouSite/release/diagnostics.json').Replace('\', '/')
```

`tool/release-mobile-from-local.sh` 已把该文件通过 `--dart-define-from-file` 传给 Flutter；缺失文件配置时仍可构建仅本机记录的 APK。Debug 验收还需显式传 `--dart-define=WENYOU_ENABLE_ERROR_REPORTING=true`，普通 `npm run check:apk` 不自动启用发送。

Windows 使用专用测试账号验证：问题编号对应 Sentry event ID（去除 UUID 连字符），API 的 `request_id` 可对照后端日志；原始信封无正文、URL、账号或凭据；断网后恢复只补发诊断，关闭开关不发送，退出/切号后旧会话记录不复活。现有实现仅覆盖 Dart/Flutter 诊断，不覆盖 Java/NDK 崩溃、ANR 或 OOM。取得 DSN、重新构建及真机真实收件均为待办，不能以本次 HTTP 冒烟替代。
