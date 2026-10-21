# 主题帖字体资源事实源

字体只作用于主题帖正文指定文字，不替换 Web 或 Flutter 的应用系统字体。正文只持久化版本化 `fontId`，不写入第三方 URL、CSS、包路径或字体二进制。正文语义见 [Markdown 模块](modules/markdown-content.md)，目录入口见 [API 契约](api-contract.md)。

## 源、资产与发布状态

- [家族目录](../contracts/thread-font-catalog-v1.json) 定义本批用户选定的 29 个独立家族和状态，不以同一家族字重或区域版凑数。
- [源锁](../contracts/thread-font-sources-v1.json) 固定上游提交／Release、下载地址、容器 SHA-256 与大小。ZIP 另外固定成员路径、字体 SHA-256 与大小，永不解包执行附带脚本。
- [正式资源 manifest](../contracts/thread-font-manifest-v1.json) 是构建后的实际覆盖、分片和大小事实源；[schema](../contracts/thread-font-manifest-v1.schema.json) 供消费者校验。`ready` 表示本地资产与许可材料已核验；`pendingSource` 没有可发布资产，不能作为新写可用项。
- [生成索引](../src/common/text-font-assets.generated.ts) 只包含目录、完整 manifest 的相对路径／SHA-256／字节数与预算，供运行代码编译，不依赖运行目录读取 `contracts/`。

`ready` 不代表已经上传或上线。此任务只生成可审查本地产物，未写入真实对象存储、未发布、未部署。客户端必须同时取得后端能力、可用状态和已配置的自有资源 `assetBaseUrl`，再加载对应资产。缺字体、离线、完整性失败或超过预算均使用系统字形回退，保留原文字和 `fontId`，不得删字或把请求发送给第三方字体 CDN。

## 分类与消费端迁移

目录、`GET /meta/text-fonts` 及 manifest 的 `designLanguage` 必填，取 `zh` / `ja` / `en`，按主要设计语言分为中文 13、日文 10、英文 6；不表示完整字符覆盖。日文包含侵食明朝、冒险黑体、白光明朝、怪盗予告黑体及新增六款。消费者按字段分组；旧后端缺失字段或未来未知值时保留未分类／系统回退，不按名称或研究别名猜测。站酷小薇体是本任务未发布候选，已从目录移除；没有线上退役或数据迁移。

`deliveryMode` 为 `subset` 或 `original`。普通分片仍使用 WOFF2／SFNT；原件仅一个 `original` 片，两端指向相同 TTF。`family` 是运行时注册别名，小城原字库内部名称保持不变。未知模式回退，不能假定 Web 一定是 WOFF2。

## 授权与归属

OFL 字体的子集、格式转换和向读者分发遵循 [SIL OFL 官方 FAQ](https://openfontlicense.org/ofl-faq/)。原 OS/2.fsType 为 8（铁蒺藜、朱雀）或 4（缝合像素）的已锁 OFL 字体，在派生时依据完整 OFL 授权归一化为 0；原值写入归属 `sourceFsType`。这不等于忽略权限：restricted、禁止子集、仅位图或未知标志仍拒绝构建，非 OFL 字体不得走该归一化路径。

每个家族输出原始完整许可文件及独立归属 JSON；后者保存原字体 name0 版权、商标、厂家、设计者、name13/14、固定来源和修改说明。所有派生字体都改为 `WYF1-<sourceFontHashPrefix>-<shard>` 内部 family／PostScript 名，CFF 名称也同步改写，避免沿用 Reserved Font Name。派生字体菜单也不沿用 RFN：`wenkai` 展示为“文楷”；归属 JSON 的 `upstreamName` 独立保留“霞鹜文楷”作为原始来源信息，不作为派生主名称。

用户提供的 BOOTH 原始 ZIP 作为固定上游输入，经 ZIP 与内部字体双层哈希核验；`--source-dir` 使后续构建不依赖登录。侵食明朝与冒险黑体使用 ZIP 中的完整 OFL 文件。白光明朝 ZIP 不含独立许可文件，授权依据是原字体 name13/14 与[作者官方页](https://lavsic.booth.pm/items/8292561) 的 OFL 1.1 声明；构建附固定 Adobe 上游的完整 OFL 文本，并独立保留该字体原始 Adobe 版权，源锁明确其文本来源，不声称 ZIP 含不存在的文件。

怪盗予告黑体使用用户提供的官方 ZIP，固定容器及 TTF 的双层哈希。原字体 name13/14 与[作者官方页](https://lavsic.booth.pm/items/7920588) 声明 OFL-1.1，ZIP 没有独立许可文件。分发通知由治理依据原字体 name0 的 Adobe 版权、保留名称 `Source` 与完整 SIL OFL 1.1 正文组装，源锁和归属记录明确该来源，不称为原包附带文件。

小城拉风体依据负责人确认的本项目授权，标记 `LicenseRef-ProjectAuthorization`，不虚构独立授权文书。原 ZIP 和 TTF 已完成哈希、许可和 cmap 核验；仅按原字节分发，不执行改名、子集、WOFF2 转换、fsType 归一化或重新序列化。两份包内许可随资产保留。原件构建与复验后已标记 `ready`。Special Elite 单独使用 Apache-2.0，不归入 OFL。

## 固定分片与成本

OFL 构建只在发布准备阶段运行。`core` 固定为 GB2312 一级汉字 3755 个，加可打印 ASCII 95 个及清单中标点，与源 cmap 取交集；其余字符按 Unicode 2048 码位页划分，覆盖扩展平面。分片互不重叠，所有源 cmap 字符恰好落入一片。不是按帖子、读者、请求或正文内容动态生成。日文假名不在 `core` 固定集合中；必须根据可见正文的 `unicodeRanges` 加载对应额外分片，不可把 core 缺假名误判为整家族无日文字形。

每片由同一子集生成 WOFF2 和移动 SFNT（原始轮廓是 CFF 时保留 OTF，否则 TTF），分片记录 `unicodeRanges`、实际字符数及两个平台各自的 SHA-256、字节数和 MIME。每个 OFL 家族的派生 face 元数据统一为 `baseWeight: 400` / `baseStyle: normal`（Regular）；只归一化字重／斜体元数据，不改变原有笔画风格。原始字重、fsSelection、macStyle 和 italicAngle 保存在归属文件中。Web／Flutter 根据独立的粗体、斜体标记合成，真实引擎效果仍需消费者实际验收。

完整 coverage 同时报告 ASCII、GB2312 和常见标点的命中／缺失；不伪造缺失字形，不以少量缺字淘汰已选定风格。客户端将缺失字符交给系统字体。

Web 按正文实际字符和可见范围选择所需分片，使用 `FontFace` 和覆盖信息加载，避免给全目录注入可自动并发下载的 `@font-face` 样式。Mobile 只下载并注册相同固定分片，以分片唯一 family 名构造 fallback；不能因为一个罕见字就载入整家族全集。Flutter 字体注册通常不能可靠卸载。v1 消费者离开页面不清零累计注册预算；v2 消费者改用已核验有限快照账本，见[运行策略](thread-font-runtime-policy.md)，两者均不能按页面重置原生注册记录。

manifest 的 `limits` 保持 v1 累计语义，未启用新策略的消费者必须遵守；它不是后台承诺已经计费或具有云端断流能力。显式匹配独立[运行策略 v2](thread-font-runtime-policy.md) 后，消费者才采用新网络窗口及分平台驻留／注册规则，不能直接改义旧字段：

| 范围 | 上限 |
| --- | --- |
| 同时下载 | 2 |
| 单进程累计字体家族 | 8 |
| 单进程累计字体请求 | 64 |
| Web 字体下载总字节 | 16 MiB |
| Mobile 字体下载／注册输入总字节 | 24 MiB |
| Mobile 已注册字体分片 | 32 |
| 磁盘缓存 | 64 MiB，按 SHA-256 LRU；正在使用的片不删除 |
| 单次客户端下载超时 | 15 秒 |
| 单字体资产 | 6 MiB |
| 单上游源容器 | 64 MiB |
| 当批源容器总量／构建包 | 各 512 MiB |
| 保留发布版本资源合计 | 1 GiB |
| 分发每月流出预算 | 500 GiB，发布时另设自有 CDN／网关硬上限及告警 |

字节预算不等于运行时内存上限：字体引擎还会分配字形、布局和渲染缓存。当前约束限制解码输入、并发与注册数量；真实 Web／Flutter 进程峰值与低内存回退需要客户端实际设备测量，不把 SFNT 大小当成 RSS 实测结果。字体选择器不能预加载全目录；用于预览的字体同样计入会话预算。

## 小城原件的有界预算例外（v1）

仅 `xiaocheng-lafeng` 的固定 SHA `cf4a4215e562d6de6e3ee88f25fc5d47d77668d28eb3a0f2533c7290de307423`、18,410,600 字节原件可携带以下 `budgetException`；schema 限定完整对象，不接受其他 ID、哈希或放大的额度：

```json
{
  "kind": "original-source",
  "assetSha256": "cf4a4215e562d6de6e3ee88f25fc5d47d77668d28eb3a0f2533c7290de307423",
  "assetBytes": 18410600,
  "additionalSessionBytes": 18410600
}
```

通用 6 MiB 单资产、Web 16 MiB／Mobile 24 MiB 总字节预算保持不变。该原件使用独立的 18,410,600 字节进程累计额度，不能转给其他字体或许可文件；下载或首次从缓存注册前预占，失败／超时也不归还已占额度，禁止用反复重试绕过上限。其余资产与通知仍扣通用预算，两个额度不可互借。故最坏累计输入为 Web 35,187,816 字节、Mobile 43,576,424 字节。家族、请求、并发、15 秒超时、64 MiB 缓存和注册数仍统一计数；原件在一个进程至多下载／注册一次，已注册 face 可复用，同 SHA 的两端描述不是两个对象。消费者不支持此例外时保持系统回退。原件 fsType=8、内部 family、DSIG 等全部保留。

## 本批实测结果（目录 1.1.1，未发布）

29 个登记家族均为 `ready`。固定源容器共 223,542,537 字节，生成 869 个分片／原件条目；Web 输入总量 113,973,584 字节，Mobile SFNT 总量 203,056,088 字节。按路径去重并加入 manifest 后为 1,799 个对象、303,835,700 字节。客户端不得预加载全集。

manifest 大小 5,031,019 字节，SHA-256 为 `7aab91a436933049bc8f55c1aba6085078a251d174c5b253456d3af0c91a0582`。小城的同一 TTF 在 Web/Mobile 只占一个存储对象；实际源字节、内部名称、fsType=8 与 DSIG 均保留。许可和通知也参与对象／请求预算。

目录按主要设计语言分类，实际缺字由 `coverage` 和 `unicodeRanges` 表达。小城 GB2312 6,763 字完整，ASCII 93/95，缺 U+0022、U+0027；标点缺 U+2018、U+2019。敬峰中山王篆只有 18 个 ASCII，拉丁字母为零；不得把系统回退误报为本字库字形。日文假名应匹配额外分片，Hachi Maru Pop 缺少小假名 ゕ／ゖ；英文六款按拉丁设计，不承诺中文覆盖。

新增公开源全部固定 Google Fonts 提交 `47d54ca1ebb14fd864695f1d39dc734f39017c33`。Orbitron 只固定 `instance: {"wght": 400}`，移除变量轴后再构建静态分片；不会按用户字重动态生成。Special Elite 使用完整 Apache-2.0 许可，已核对该固定目录无 NOTICE 文件，归属保留原版权并说明修改。声明 RFN 的四款派生展示名与原始来源如下，ID 保持稳定，源名只用于归属：

| ID | 展示名 | 原始来源 |
| --- | --- | --- |
| unifraktur-cook | 古典哥特 | UnifrakturCook |
| monoton | 复古线体 | Monoton |
| orbitron | 星际几何 | Orbitron |
| rye | 西部衬线 | Rye |

侵食明朝原件的 GDEF 使用 1.0 结构但误写版本 0。构建只修正版本，保留 mark class 与布局数据，并在归属 `tableRepairs` 记录；未知扩展结构拒绝修复。

怪盗原件 Version 1.001 为 Heavy/900、fsType=0、无变量轴；`post.stringData` 存在 522 个未引用尾随字节。标准 fontTools 子集重编译后不再出现该警告，没有修改原件或新增手工表修复。60 个固定分片的 WOFF2／TTF 共 120 个文件已逐码位核验：44,812 个原 cmap 码位完整保留，轮廓坐标、曲线点标记与横向度量均相同；core 重建逐字节一致。最大 Web 片 1,312,004 字节、Mobile 片 2,284,176 字节，未扩大通用预算。全部新片通过 Chromium 解码与绘制；这只验证 SFNT／WOFF2 管线，不代表 Flutter 设备验收。其余 28 款目录项及全部资产与目录 1.1.0 相同。

验证使用 Python 3.12、fontTools 4.46.0、Brotli 1.1.0。原件测试禁止调用改名、子集、表修复和字体保存，验证原字节相等；源身份、预算例外、普通额度和源变更拒绝均有回归。实际浏览器解码与隔离正文 E2E 的结果在 PR 记录，不把离线构建成功当作 Flutter 设备、峰值内存或产品视觉验收。

## 重建、验证与交付

在独立工具虚拟环境使用 Python 3.12 与 [固定构建依赖](../scripts/fonts/requirements.txt)。字体原件、下载缓存与发布包放在任务临时目录，不提交大字体文件，也不写仓库上传目录。

```bash
python3 -m venv /tmp/thread-font-tools
/tmp/thread-font-tools/bin/pip install -r scripts/fonts/requirements.txt
source /tmp/thread-font-tools/bin/activate
python3 scripts/fonts/fetch.py --root "$PWD" --cache /tmp/thread-font-cache --source-dir /tmp/thread-font-sources
python3 scripts/fonts/build.py --root "$PWD" --cache /tmp/thread-font-cache --output /tmp/thread-font-release --source-dir /tmp/thread-font-sources
python3 scripts/fonts/build.py --root "$PWD" --cache /tmp/thread-font-cache --output /tmp/thread-font-release --verify
node scripts/fonts/check-contract.cjs
python3 -m unittest discover -s scripts/fonts -p 'test_*.py' -v
```

仅扩充新源且原配方未变可使用 `--extend`：先完整复验旧资产并比对源／许可／实例，再只构建新增项；修改旧配方必须完整重建，不能使用此参数。

仅目录元数据变化可用 `build.py --refresh-catalog`，先复验现有二进制，要求源、许可、通知、分发模式和实例参数保持一致，不重写字体；新源必须构建。

`fetch.py` 是明确的上游只读下载入口；构建默认全离线，只有显式 `--download` 才读取锁源 HTTPS。缓存命中仍检查大小与完整哈希；版本、许可、archive member、嵌入权限标志、cmap、命名、大小与任何资产校验失败都会停止，不生成可发布的新 manifest。构建固定工具版本和 OpenType 时间戳；测试实际验证相同输入重复生成逐字节一致的 SFNT/WOFF2。

输出 `fonts/v1/<完整SHA-256>.<扩展名>`、完整 manifest 和 `release-review.json`。发布审查使用新的独立目录，只复制最终 manifest 引用的字体、许可、归属及 manifest 本身；不把 checkpoint、旧 manifest 或未引用资产整目录上传。最后两个文件在全部家族及资产核验完成后写入；中断仅留下可复验 checkpoint 与内容寻址资源，不视为成功发布。恢复构建重新校验 checkpoint 的全部文件。

经独立合并及发布授权后，运营步骤应为：离线复验完整包 → 核验自有存储／CDN 容量和月流出硬上限 → 上传内容寻址资源及全部许可归属 → 对照完整 manifest 核验每个对象字节／哈希／MIME → 上传 manifest → 只读校验缓存、CORS 和错误回退 → 配置自有 base URL → 单独批准启用新写。不覆盖既有 hash 路径，不删除旧资源兼容，不使用第三方源作为运行时兜底。

字体与 manifest 返回 `Cache-Control: public, max-age=31536000, immutable`、基于内容哈希的强 ETag、准确 Content-Type、`X-Content-Type-Options: nosniff`，跨域读取只允许审核过的客户端 origin（不带凭证）。客户端先校验 manifest 描述符；首次取得一个家族时同时取得并核验该家族的 `notices`，让完整许可／归属随离线字体缓存保存，展示归属时明确原始来源名。许可文件按内容哈希共用，通知文件请求同样计入请求预算。再校验字体实际长度和完整 SHA-256 后才能缓存／注册；304 只能复用已经验证的本地条目，损坏缓存删除后最多一次直接重试；v1 失败进入本次会话回退，v2 的暂时失败按独立窗口和退避恢复，完整性／解码错误隔离，防止请求风暴。

测试只使用自行生成的测试字形与临时目录，不涉及数据库、Redis、上传桶或线上账号。此资源流程的本地文件写入不代表已执行正文保存 E2E；正文链路仍按 [隔离规则](e2e-isolation.md) 验证。
