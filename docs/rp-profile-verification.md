# RP 资料楼层引用验收

本批基线为 `58f4526e3d4d293770428d92b332e02bb6b3fddd`，任务分支 `codex/20261005-rp-profile-post`。可消费契约提交为 `60273e5576c9837f645245ae2c610ba8a3f81ea1`，API `5.36.0-dev.20261005.1`；后续提交不改变机器契约字节。完整行为见 [资料引用规范](rp-identity-profile-post.md)。

## 最终源码与门禁

最终相对契约切片的 `git diff --binary 60273e5 -- src scripts prisma package.json` 补丁 SHA-256 为 `3ce53929cf3758e176923263995af01d03f29de1a7a52fa04f32d94dd42aac37`。完整门禁针对该冻结源码执行，之后仅增加本记录；使用同事务 client 返回资料授权投影，避免事务持有连接时再借用独立连接。

`pnpm check:full` 退出 0：依赖审计无已知漏洞，静态/架构/OpenAPI/文档/构建通过；195 套、2523 项 Jest 测试通过；HTTP 安全、预览、清理、富文本、下载/发布/数据安全工具检查及隔离清理/生命周期回归通过。完整日志位于本任务 VPS `/tmp/rp-profile-check-full.log`（不含测试私密运行资源），日志 SHA-256 为 `e85fcc5368b7d3aaf825d25a96fc925a8f393993bd97ce84bf37f3d2ba8fd349`。

## 隔离写入

所有业务写入均运行于一次性 PostgreSQL/Redis、独立上传路径及随机测试账号。入口为 [e2e-runner.ts](../scripts/e2e-runner.ts)；资料专项 `--suite=rp-profile` 已纳入 `--full`，脚本先核验 manifest、数据库 cluster_name 和 Redis 身份。

- 独立专项 `e2e_784817a925978dd69b8b6144` 通过，`resourcesCleaned=true`，原运行目录 `/tmp/wenyousite-e2e-mEJYnJ` 已不存在。
- 最终全量 `e2e_582d4d98502cfbfd5535fcea`：22 条旅程全部通过，`resourcesCleaned=true`，原运行目录 `/tmp/wenyousite-e2e-8gOAW3` 已不存在，任务登记为空。
- 早期 `e2e_3401489b58b5b2ffcbd5f6ec` 因第二子贴样本遗漏独立 sortOrder 失败；`e2e_a46d7999ac3c9c421adbc3eb` 因测试误把 DTO 格式错误码期望为 40001 失败。均已修正且核对资源移除，私有诊断已清理；最终复验不省略任何断言。实际非法 ID/URL 为既有 400/VALIDATION_ERROR=40000，业务清除冲突为 400/40001。

资料专项实际覆盖：迁移前后旧作者 token 相等、迁移重复执行、外键及硬删除 SET NULL；他人代贴、跨子贴 BODY/主楼/楼中楼、多个角色共享引用；正文/媒体/提及/骰子/坐标读取与原文更新；并发版本只成功一次；跨帖、被隐藏父楼/子贴、真实删帖、双向拉黑拒绝；私帖撤权、关闭重开、资格失效、归档；省略/null/clear flag、旧 single clear 保留原绑定；只改资料保留 token，昵称变化仍使 token 失效，历史作者快照不变。

## 交付边界

本批只交付兼容后端与资料契约，没有合并、部署、公网自动业务写入或重启共享预览。`RP_MENTION_V6_ENABLED` 默认 false 和全局 Markdown 5 不变。Web/Mobile/Foundation 的消费与视觉验收由治理分别记录，本记录不代替客户端或负责人验收。

迁移仅追加资料外键和独立作者版本，保留内容。回切旧二进制需要考虑旧角色编辑只增加 version、不会同步 author_version；应优先前滚，必要回退前停止角色编辑并评估版本同步，不能直接删列。先前多身份唯一约束的回滚限制继续适用。旧 `rp-multiple-identities-backend` 工作树与本任务工作树保留，不清理仍在使用的验证现场。
