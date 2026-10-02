# 邮件依赖与安全回归

邮件由 `EmailService` 经 Nodemailer 发送。生产保持直接 TLS SMTP、现有账号认证与 `disableFileAccess` / `disableUrlAccess`；测试和隔离预览使用 JSON transport，预览邮件仅写本任务私有收件箱。业务邮件主题、正文、失败传播和 SMTP 配置未因依赖升级改变。

## Nodemailer 10 兼容边界

依赖精确锁定 `10.0.9`；保留 `10.0.2` 已引入的 [GHSA-6vj9-mwq6-2f5v 修复版本](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-6vj9-mwq6-2f5v)。受影响版本在多个直接 TLS transport 共用 DNS 主机但使用不同 `tls.servername` 时，可能将前一连接的证书名称带入后一连接。升级后 DNS 缓存不再复用连接专属的 TLS 名称；不得通过关闭证书验证或忽略审计代替修复。

[10.0.2 变更记录](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.2)包含该 DNS 缓存修复；[10.0.0 发布说明](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0)要求 Node.js 20 以上并提供 CommonJS / ES module 双构建。本项目继续使用 CommonJS，升级验证运行时为 Node.js 24.18.0；无需更改 Node 或部署设施。

按[官方类型说明](https://nodemailer.com/)，移除旧 `@types/nodemailer`，使用包内声明。已验证现有 `nodemailer/lib/json-transport` 类型导入及测试的 `nodemailer/lib/mailer/mail-message` 路径与新版导出兼容，不增加类型垫片或调整模块解析选项。同批安全补丁同时更新 HTTP 与间接解析依赖，版本及审计证据见[依赖安全补丁验收](verification/20261002-dependency-security.md)。HTTP/OpenAPI、数据模型及编辑时间语义不变。

## 验证与资源边界

- `src/email/email.service.spec.ts` 覆盖 TLS 选项、邮件内容与失败传播。
- `src/email/nodemailer-security.spec.ts` 使用实际依赖验证旧式 `resolveContent` 仍拒绝文件与 URL 读取，受控 HTTP 服务不收到请求。
- `src/email/nodemailer-transport.spec.ts` 验证真实 JSON 预览收件箱、stream 正文生成，以及真实回环 TLS SMTP 的认证与 DATA。TLS 场景仅把 DNS 解析固定到回环地址，保留实际依赖的 DNS 缓存、SNI、证书校验、SMTP AUTH 和邮件组装。首次正确名称成功，缓存命中后的错误名称在 AUTH 前被拒绝，再次正确名称仍成功。
- `scripts/dependency-parsers.test.ts` 在 128 MiB 堆、5 秒强制超时的独立子进程运行实际地址解析器，覆盖长自由文本、连续注释与引号 local-part 后的注释域名边界；不继承业务凭据或 `NODE_OPTIONS`。
- TLS 证书和合成邮件每轮生成于独立临时目录；测试结束关闭连接和监听、清除本测试缓存键并移除临时目录。无真实邮件投递，不读取生产 SMTP 凭据，不写数据库、Redis 或线上业务数据。

定向入口：

```bash
pnpm test --runTestsByPath src/email/email.service.spec.ts src/email/nodemailer-security.spec.ts src/email/nodemailer-transport.spec.ts
pnpm test:http-security
pnpm security:audit
pnpm check:full
```

本次批次同时升级 HTTP 依赖并修复管理 CSRF 路由判定，必须执行 `pnpm check:full`，包括独立 PostgreSQL/Redis 的 HTTP、认证、管理和其他关键旅程。正式发布继续由官方部署脚本重新执行安全审计及发布门禁；不得通过降级到受影响依赖或忽略审计交付修复。部署故障优先前滚，保留上一成功 release 及备份并按运维规则处理应急恢复。
