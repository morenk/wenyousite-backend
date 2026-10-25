# 传统位图混合字体兼容验收

任务分支：`codex/20261025-font-outline-bitmap-compat`。基线：`8a5d21858e04c69832c90e5a3a10f1e70fdcb545`。实现与测试仅在 VPS 的独立 Worktree 进行，保留 Worktree 供合并评审，不合并、不部署、不重试线上任务。

## 处理边界

两版编译器在解编译前移除传统 EBDT/EBLC/EBSC，以矢量轮廓生成 WOFF2、SFNT 和样张。私有上传原件不改写。完整 cmap/layout closure 所需的可见字形必须有真实轮廓；合法空白与默认忽略字符保留空字形，未编码且无 cmap/layout 引用的推荐占位不造成整份拒绝。空格/可见字符别名与 GSUB 引用空占位仍拒绝。

混合位图 TrueType 的陈旧 bbox 在既有归一化中可能造成明显横移。本次先记录水平 `lsb-xMin` 与垂直 `tsb+yMax`，重算真实 bounds 后校正 bearing，保留字形原点及 advance。范围仅限混合位图 glyf 输入；普通矢量字体沿用原路径。notices 记录位图移除及实际发生的 bearing 校正。

纯位图、可见轮廓不足、COLR/CPAL/CBDT/CBLC、sbix、SVG 和 OS/2 授权限制保持原拒绝边界；默认轴、限额、沙箱、内容寻址及不可变产物不放宽。位图的小字号栅格效果不保留。

## 最终验证

- `pnpm check` 通过：231 个 Jest suite、3129 个测试，以及全部后续脚本、文档与构建门禁。
- `pnpm exec tsc -p scripts/tsconfig.e2e.json --noEmit` 通过。
- `pnpm security:audit` 通过；没有依赖或 SQL 变化。
- `pnpm test:integration:font-formats` 最终 62 例通过，runId=`font-formats-92jv0C`，两版参数均覆盖静态/双轴 TrueType 与 CFF/CFF2 的传统位图组合、真实 sbit/EBSC、推荐占位、陈旧 bbox、USE_MY_METRICS 组合字形、GSUB/GPOS、空白别名和既有格式/权限拒绝。
- 无 hint 静态夹具 32/64px 的源/产物像素精确相等；源默认展开轮廓、advance、横纵全局度量、垂直原点及样张仍采用零容差检查。变量字体沿用现有的独立默认轮廓与序列化静态样张判据，没有扩大容差。
- 没有数据库/API、权限、客户端或跨端正文改动；不运行 `check:full` 中无关的写入 API/数据库旅程。真实非 root、无网、限额解析与产物校验由上述专项覆盖，沙箱实现未变。

预修正批次另验证了固定官方 Source Serif 4、Orbitron、Train One、Source Han Sans 的 v1 处理，作为补充归因证据；该批次在私有原源处失败，整体不计通过，也不计入最终 62 例。中间失败促成推荐占位和陈旧 bbox 回归，最终结果以本节 runId 为准。

## 私有故障原源

来源为失败任务 `5e8a2b60` 的受控只读副本。SHA-256=`fef7cf991b458cabd184b73378918d9d15429010e1d6c804f08d394395c3c3b4`，3996872 字节。两版均完整保留 7541 码点、生成 49 分片；源展开轮廓、字宽、布局及样张验证通过，输出无传统位图表。

两版样张相同：`2db46053df49bb27c605b5943adc67e99837843e9e879361237251ca91a01f9a`，11135 字节。已实际查看离线 FreeType 样张，文字可读、无缺字或明显重叠；没有浏览器或 Android 真机验收，`mobileRendered` 不代表原生客户端验收。

编译器 SHA-256：

- v1：`e97eb06ffdcf304029fa99354c5f8da8168b14a8d82a60d2075328a25333475c`
- v2：`93d4b8acd5c24efadde242c605c8448f3f68d3bc57cd759ca8052ca73942bca0`

摘要参与 buildKey，后续重试构建新身份，不覆盖旧版本或产物；本轮未重试或改写线上失败任务。本次无 HTTP/Schema/契约版本变化，不需要 Web、Mobile、Foundation 或弃用登记同步；兼容说明见[动态字体](../dynamic-text-fonts.md)。

## 隔离及清理

最终运行仅使用本次随机文件目录，不连接业务数据库、Redis、API 或对象存储；业务写入为 0。沙箱输入/输出临时目录已由入口清理。删除前复验源摘要，原源副本、配置快照、一次性诊断与 probe 目录全部清理；公网源及任务未改动。

验证产物、`run.json`、`cleanup.json` 和日志保留在 Worktree 的私有 `.cache/bitmap-delivery-evidence`（目录 0700，记录 0600），不提交字体二进制或原元数据。源提取 runId=`font-user-sample-5e8a2b60-20261025`。

默认 Auto-review 偏好已传递；当前协作工具没有审批配置入口，实际 Auto-review 未设置/核验，不能把继承的 `approval_policy=never` 视为 Auto-review。
