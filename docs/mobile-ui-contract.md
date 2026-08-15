# Flutter 设计基础边界

状态：`external-source`

后端不再维护移动端审美、字体、布局和编辑器工具栏的副本。跨端共享 Token、体验能力及 Flutter 平台规范由公开仓库
[`morenk/wenyousite-foundation`](https://github.com/morenk/wenyousite-foundation) 统一维护：

- [共享设计基础](https://github.com/morenk/wenyousite-foundation/blob/main/docs/foundation.md)
- [Flutter / mobile profile](https://github.com/morenk/wenyousite-foundation/blob/main/docs/platforms/mobile.md)
- [跨端图片呈现契约](https://github.com/morenk/wenyousite-foundation/blob/main/docs/images.md)
- [机器契约](https://github.com/morenk/wenyousite-foundation/blob/main/contracts/foundation.v1.json)
- [审美指导 skill](https://github.com/morenk/wenyousite-foundation/tree/main/skills/wenyou-design)

Flutter 客户端的 `foundation.lock.json` 决定实际生效版本；本文件只提供仓库发现入口，不固定或转录色值、字体版本、能力矩阵和验收表。

边界保持如下：

- HTTP 字段、认证、分页、幂等、媒体、错误码与 FCM 生命周期仍以本仓库的 [`mobile-client-guide.md`](./mobile-client-guide.md)、OpenAPI 和 fixtures/schema 为准。
- Markdown 存储与安全降级由本仓库的三份 Markdown v3 黄金语料定义；Foundation 同时固定工具栏作为结构化能力来源，第三方解析器不能改变内容协议。
- Flutter 的字体资产、平台布局、文字缩放、48dp 触控、安全区和视觉验收由基础仓库 mobile profile 与客户端实现负责。
- 新增 API/数据协议回到后端；新增跨端视觉或体验语义先在基础仓库发布版本，再升级客户端锁。
