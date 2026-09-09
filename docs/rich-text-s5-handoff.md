# 富文本 S5 真实保存验收入口

本页只准备已授权的专用测试账号验收，不执行合并、部署、服务重启、迁移或账号创建。真实写入仅限本轮由专用测试账号新建的对象；候选编辑器实测、实际 API 保存、负责人设备验收分别记录，不互相替代。

## 后端可用性与版本证据

比较基线：公网 `6bfb818df4ccf5333df7b62018a9f519d91e935b`，Backend 候选 `6abb3a5315ef4f13e689eab4345352daa4adf0a4`（[PR #12](https://github.com/morenk/wenyousite-backend/pull/12)）。两者生产 `src` 完全一致；唯一新增 src 文件为构建排除的 `*.spec.ts`。依赖、锁文件、Prisma schema/migration、构建配置和 Compose 无差异；package.json 只新增测试与文档门禁命令。候选增加的是测试工具、契约语料与文档，没有新的运行时 API 能力要求。

本轮只读检查本机和公网 health 均为 HTTP 200，meta 均返回上述公网 SHA、HTTP 契约 `5.18.0-dev.20260905.1`、Markdown 5。因此在本专项已定义正文与接口范围内，这批 Web/Flutter 候选可使用现有公网 API 完成合成保存，不需要为 Backend PR #12 切换共享服务；这不等于客户端旅程已经通过。开始实际验收前再次读 `/api/v1/meta` 并记录时间及 SHA，若源码/契约已变化则重新核对。

```bash
git diff --name-only 6bfb818 6abb3a5 -- src ':!src/**/*.spec.ts'
git diff --exit-code 6bfb818 6abb3a5 -- prisma pnpm-lock.yaml nest-cli.json tsconfig.json tsconfig.build.json docker-compose.yml
```

运行记录应区分 API 实际 SHA 与客户端候选 SHA/build。公网推荐 APK 元数据不代表候选已安装；Windows ADB 没有设备时，移动端设备验收保持待执行。

## 专用账号与现有 E2E 边界

VPS 已知 Web 配置入口是 `/srv/wenyousite/wenyousite-frontend/.env.e2e.example`，登录适配器是 `/srv/wenyousite/wenyousite-frontend/e2e/fixtures/auth.ts`，读取 `E2E_EMAIL`、`E2E_PASSWORD`。当前检查进程这两个变量均未配置；已检查主仓库和工作树位置只发现模板，未找到可直接使用的实际 E2E 配置。该结论不表示负责人没有测试账号，也未尝试登录验证账号有效性。请通过既有受保护配置或客户端登录界面使用已有专用账号，凭据不写入本页、Git、命令行参数、日志、截图或回执；关闭认证阶段的请求正文和 trace 采集。

Web 的标准 `playwright.config.ts` 限制前后端为 loopback；完整 Backend `scripts/api-e2e-test.ts` 同时限制 loopback 和独立测试数据库。不能把这两个完整套件改指向公网，不能以回环地址掩盖共享数据。公网定向烟雾应走候选客户端正常登录与新对象流程，由 Web 任务安排浏览器入口。一个账号仅有一个 Web 和一个 mobile 登录终端；两端可配合，但同类终端顺序执行，避免互相撤销会话。移动端登录遵循 [移动接入说明](mobile-client-guide.md) 的终端与刷新规则。

`/etc/wenyousite` 下运行与迁移配置当前应用开发身份不可读，本轮没有读取其内容，也不需要借用数据库权限来完成公网账号验收。

## 固定合成正文与请求形状

以下正文直接引用 [共享 fixture revision 2](https://github.com/morenk/wenyousite-backend/blob/6abb3a5315ef4f13e689eab4345352daa4adf0a4/contracts/rich-text-behavior-v1-fixtures.json)，不是从待测客户端刷新答案。fixture SHA-256：`c3499979edc72ec1b39905246d541ae561dc02a62e312a792be307f4fd596814`。

A 为 `rtb-soft-manual-boundary.initial.canonical`，B 为同例 `continue.expected.canonical`：A 是居中的甲/LF/乙；B 保留该段，并新增独立左对齐段丙。C 为 `rtb-explicit-empty-ownership.initial.canonical`，用于负责人 RT-04 引用内部空行原场景，须单独记录验收。

```json
{
  "A": "[wenyousite-align-v1-center]: #\n甲\n乙",
  "B": "[wenyousite-align-v1-center]: #\n甲\n乙\n\n丙",
  "C": "> 甲\n> <br />\n> 乙\n<br />\n尾"
}
```

接口以已提交 [OpenAPI](../contracts/openapi.json) 为准。第一轮优先使用私密、未发布的新主题草稿，避免占用已有云草稿槽位或修改历史正文。正常登录后，`POST /api/v1/threads` 可用以下合成载荷创建 A；实际执行时标题尾部换为本轮唯一标识，clientRequestId 使用新 UUID v4，同一创建请求的网络重试复用该 UUID。下面省略认证头，不提供凭据命令。

```json
{
  "title": "S5-rich-text-本轮唯一标识",
  "visibility": "PRIVATE",
  "content": "[wenyousite-align-v1-center]: #\n甲\n乙"
}
```

该端点创建 published=false 主题。只记录本次成功返回的新 threadId；通过 `GET /api/v1/threads/{threadId}` 找到 `data.defaultSubthreadId` 对应的 `data.subthreads[]`，从该项及其 bodyPost 取当前版本与正文。保存 B 使用 `PATCH /api/v1/threads/{threadId}/aggregate`：content=B、tagNames=[]、version=当前主题版本、defaultSubthreadVersion=当前默认子贴版本、bodyVersion=当前正文版本。版本来自本轮刚读到的响应，不固定为 1，不自动重试覆盖 409；不设置 published=true。随后重新 GET 并比较正文的规范写法和结构。

这是独立 API 烟雾的请求形状；直接发送该 JSON 只能证明 API 保存，不能冒充编辑器操作或设备验收。实际跨端流程必须让对应候选编辑器形成 A/B，并检查它发送的当前正文与上述预期一致。不要把 Markdown 源码当外部纯文本直接粘进编辑器，再把字面标记误认为富文本结构。

## 移动端与 Web 双向入口

1. 记录候选源码 SHA、Android versionName/versionCode、实际安装包身份，以及 API `/meta` 的运行 SHA；正常登录专用账号，使用候选的主题新建入口创建本轮私密草稿。无设备时停止在准备状态。
2. 第一只新对象：Web 候选创建/保存 A，移动候选在同一账号的主题草稿列表打开该对象，核对居中段和 LF；在段尾手动 Enter 并输入丙形成 B，实际保存、退出、重开。Web 候选再打开并核对 B 的独立左对齐段。
3. 第二只新对象执行反向：移动创建 A，Web 形成并保存 B，移动重开核对。两端在同一对象上顺序编辑；每次保存使用最新版本。
4. C 的引用内部空行属于独立负责人原场景。使用另一只本轮新对象，通过候选控件构造并保存 C，核对引用中的空行、外部空段及“尾”的归属。仅 API 接受 C 不构成 RT-04 设备验收。原已验收 Enter/H2/H3/引用标记场景不因此重开。
5. 编码故障在已提交的客户端测试入口中注入并验证保护，故障恢复后再做真实保存；不要伪造公网 40009 或对共享服务注入故障。Web 丢弃确认与移动 local-snapshot 关闭按 [比较器适用边界](https://github.com/morenk/wenyousite-backend/blob/6abb3a5315ef4f13e689eab4345352daa4adf0a4/docs/modules/rich-text-behavior.md#结果与分阶段诊断) 分开记录。
6. 仅对本轮新建且已完成读取验收的对象逐个清理，依据本轮明确记录的 ID 和标题核验归属；保留清理结果。未完成交接的对象保留并注明，不按标题前缀批量搜索删除，不触碰已有主题或云草稿。

每次真实请求仅记录方法、无敏感查询串的路由、HTTP 状态、受控业务错误码、当前/新版本、合成正文 UTF-8 SHA-256 及独立结构比较结果。对象 ID 仅留在受保护的本轮交接清单；不保存完整 HTTP 响应、认证头、Cookie、用户对象或实际私密正文。real-api 记录与 unit-editor 回执分开，未执行的阶段如实记录，不填 passed。负责人设备目视结果另列 device-owner。

负责人已确认段落内粘贴遵循光标所在目标段落的对齐；多块粘贴的拆段边界和最终选区仍待独立预期，不纳入本轮 A/B/C 的新判定，也不沿用来源冲突对齐属性。

## 仅在运行时能力确实不兼容时的隔离条件

本轮源码比较没有发现需要隔离 Backend 候选的理由。若后续引入运行时差异，应先核对差异再决定是否需要候选进程；不能直接启动第二个 API 连接共享数据库、Redis 或队列。

隔离候选需独立可恢复测试数据、仅 loopback 的空闲端口、应用权限身份、隔离的数据库与缓存/队列命名空间，并关闭真实邮件、推送和对象存储副作用；正常认证使用已存在的专用测试账号，不通过 Prisma 插入账号绕过注册。移动设备连接由已有获授权网络入口安排，不因本页开放防火墙或发布公网候选。

现有 `scripts/api-e2e-isolated.ts` 会建临时数据库、运行 migration、插入参考测试用户，并在结束时清理数据库与测试 Redis。它不是本次 S5 的可直接执行入口；这些动作不在当前“不迁移、不绕过认证创建账号”的边界内。本轮没有启动隔离进程、创建或迁移数据、清空缓存。
