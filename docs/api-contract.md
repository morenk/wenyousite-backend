# API 契约发布流程

## 事实源与优先级

1. `src/**` DTO、控制器装饰器与统一响应拦截器定义运行时和源 schema。
2. `contracts/openapi.json` 是经过评审、供 Web/Flutter 生成代码的固定契约产物。
3. `docs/api-endpoints.md` 与 `docs/error-codes.md` 是自动生成的人类索引。
4. 手写模块文档只解释跨请求流程和业务语义，不复制完整 schema。

若四者冲突，先修正运行时代码或装饰器，再重新生成产物；不得手工修改生成文件掩盖差异。

## 版本规则

- `MAJOR`：删除/重命名字段或端点、收紧必填、改变认证或响应语义。
- `MINOR`：向后兼容的新端点、可选字段、错误码或能力。
- `PATCH/dev`：文档、schema 精度和非破坏性修正。

每次契约变化更新 `API_CONTRACT_VERSION` 与 [`contracts/CHANGELOG.md`](../contracts/CHANGELOG.md)。运行时通过 `/api/v1/meta` 与 `X-API-Contract-Version` 暴露版本。

## 本地流程

```bash
pnpm contract:generate
pnpm docs:generate
pnpm openapi:check
pnpm docs:check
```

`openapi:check` 同时检查实时导出与已提交产物一致，因此忘记重新导出会直接失败。生成文件必须随实现提交，客户端仓库通过同步脚本固定到同一份字节内容。

## OpenAPI 约束

- OpenAPI 3.0.x、稳定且唯一的 lowerCamel `operationId`。
- 每个操作显式标注 `public` / `optional` / `authenticated` / `verified` / `admin` 认证模式。
- 每个成功响应引用具名 envelope component；分页 envelope 必含 `meta.cursor` 和 `meta.hasMore`。
- 错误统一为 `ApiErrorEnvelope`，业务代码只依赖 `BusinessErrorCode`。
- 每个响应显式声明 `X-Request-ID` 和 `X-API-Contract-Version`；显式 429 响应额外声明 `Retry-After`。
- 查询参数不允许空 schema，本地与生产 server 均显式声明。
- 未知响应字段必须被客户端忽略；可扩展枚举在客户端必须有 unknown fallback。

## 客户端消费

Web 与 Flutter 不直接下载线上 `/api/docs-json`。发布分支同步固定的 `contracts/openapi.json` 后再生成客户端，生成器版本也应锁定。生成结果的 diff 属于契约评审的一部分；出现非预期删除、nullable/required 变化或大量匿名模型时阻止合并。
