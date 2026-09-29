# 邮件依赖与安全回归

邮件由 `EmailService` 经 Nodemailer 发送。生产保持直接 TLS SMTP、现有账号认证与 `disableFileAccess` / `disableUrlAccess`；测试和隔离预览使用 JSON transport，预览邮件仅写本任务私有收件箱。业务邮件主题、正文、失败传播和 SMTP 配置未因依赖升级改变。

## Nodemailer 10 兼容边界

依赖精确锁定 `10.0.2`，对应 [GHSA-6vj9-mwq6-2f5v 修复版本](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-6vj9-mwq6-2f5v)。受影响版本在多个直接 TLS transport 共用 DNS 主机但使用不同 `tls.servername` 时，可能将前一连接的证书名称带入后一连接。升级后 DNS 缓存不再复用连接专属的 TLS 名称；不得通过关闭证书验证或忽略审计代替修复。

[10.0.2 变更记录](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.2)包含该 DNS 缓存修复；[10.0.0 发布说明](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0)要求 Node.js 20 以上并提供 CommonJS / ES module 双构建。本项目继续使用 CommonJS，升级验证运行时为 Node.js 24.18.0；无需更改 Node 或部署设施。

按[官方类型说明](https://nodemailer.com/)，移除旧 `@types/nodemailer`，使用包内声明。已验证现有 `nodemailer/lib/json-transport` 类型导入及测试的 `nodemailer/lib/mailer/mail-message` 路径与新版导出兼容，不增加类型垫片或调整模块解析选项。锁文件不更新其他依赖。HTTP/OpenAPI、数据模型及编辑时间语义不变。

## 验证与资源边界

- `src/email/email.service.spec.ts` 覆盖 TLS 选项、邮件内容与失败传播。
- `src/email/nodemailer-security.spec.ts` 使用实际依赖验证旧式 `resolveContent` 仍拒绝文件与 URL 读取，受控 HTTP 服务不收到请求。
- `src/email/nodemailer-transport.spec.ts` 验证真实 JSON 预览收件箱、stream 正文生成，以及真实回环 TLS SMTP 的认证与 DATA。TLS 场景仅把 DNS 解析固定到回环地址，保留实际依赖的 DNS 缓存、SNI、证书校验、SMTP AUTH 和邮件组装。首次正确名称成功，缓存命中后的错误名称在 AUTH 前被拒绝，再次正确名称仍成功。
- TLS 证书和合成邮件每轮生成于独立临时目录；测试结束关闭连接和监听、清除本测试缓存键并移除临时目录。无真实邮件投递，不读取生产 SMTP 凭据，不写数据库、Redis 或线上业务数据。

定向入口：

```bash
pnpm test --runTestsByPath src/email/email.service.spec.ts src/email/nodemailer-security.spec.ts src/email/nodemailer-transport.spec.ts
pnpm security:audit
pnpm check
```

本次依赖安全修复以生产依赖审计、真实邮件安全回归和完整 `pnpm check` 作为等价验证；邮件之外的既有编辑时间写入 E2E 不因升级机械重跑。后续若修改认证业务、数据库或跨端旅程，仍执行仓库规定的对应隔离集成门禁。正式发布继续由官方部署脚本重新执行安全审计及发布门禁；旧 `9.1.1` 带有已知漏洞，不作为可接受的依赖回滚目标。
