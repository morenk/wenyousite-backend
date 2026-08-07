# API 合同变更

## 3.0.0-dev.20260807.2

- 修正 ValidationPipe 参数错误为 `40000 VALIDATION_ERROR`，与已发布错误码契约一致。
- OpenAPI 为所有响应声明请求 ID 和契约版本头，429 额外声明 `Retry-After`。
- 新增 FCM data v1 JSON Schema 与黄金样例，固定通知/私聊的最小导航载荷。
- 澄清移动端 `X-Client-Platform` 必传规则和私聊推送能力，HTTP 路由与业务响应字段不变。

## 3.0.0-dev.20260807.1

- 变更分类：生成接口破坏性、HTTP 线协议向后兼容。
- 固定 lowerCamel operationId、server、鉴权模式和具名成功 envelope。
- 分页 meta 在分页操作中改为必填；清零匿名响应和空查询 schema。
- 新增移动端元数据、设备注册、媒体衍生地址、通知 target，以及创建幂等字段。
- 现有 REST 路由和旧响应字段不删除；后端先部署，Web 随后重新生成类型。

## 2.3.0-dev.20260807

- 向后兼容新增用户表情收藏和 Markdown v2 协议。

## 2.2.0-dev.20260807

- 向后兼容新增主题帖标签精确筛选。

## 2.1.0-dev.20260806

- 向后兼容新增一对一私聊。
