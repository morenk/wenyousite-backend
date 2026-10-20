# 主题帖字体资源事实源

字体只作用于主题帖正文指定文字，不替换 Web 或 Flutter 的应用系统字体。正文只持久化版本化 `fontId`，不写入第三方 URL、CSS、包路径或字体二进制。正文语义见 [Markdown 模块](modules/markdown-content.md)，目录入口见 [API 契约](api-contract.md)。

## 源、资产与发布状态

- [家族目录](../contracts/thread-font-catalog-v1.json) 定义本批用户选定的 17 个独立家族和状态，不以同一家族字重或区域版凑数。
- [源锁](../contracts/thread-font-sources-v1.json) 固定上游提交／Release、下载地址、容器 SHA-256 与大小。ZIP 另外固定成员路径、字体 SHA-256 与大小，永不解包执行附带脚本。
- [正式资源 manifest](../contracts/thread-font-manifest-v1.json) 是构建后的实际覆盖、分片和大小事实源；[schema](../contracts/thread-font-manifest-v1.schema.json) 供消费者校验。`ready` 表示本地资产与许可材料已核验；`pendingSource` 没有可发布资产，不能作为新写可用项。
- [生成索引](../src/common/text-font-assets.generated.ts) 只包含目录、完整 manifest 的相对路径／SHA-256／字节数与预算，供运行代码编译，不依赖运行目录读取 `contracts/`。

`ready` 不代表已经上传或上线。此任务只生成可审查本地产物，未写入真实对象存储、未发布、未部署。客户端必须同时取得后端能力、可用状态和已配置的自有资源 `assetBaseUrl`，再加载对应资产。缺字体、离线、完整性失败或超过预算均使用系统字形回退，保留原文字和 `fontId`，不得删字或把请求发送给第三方字体 CDN。

## 授权与归属

OFL 字体的子集、格式转换和向读者分发遵循 [SIL OFL 官方 FAQ](https://openfontlicense.org/ofl-faq/)。原 OS/2.fsType 为 8（铁蒺藜、朱雀）或 4（缝合像素）的已锁 OFL 字体，在派生时依据完整 OFL 授权归一化为 0；原值写入归属 `sourceFsType`。这不等于忽略权限：restricted、禁止子集、仅位图或未知标志仍拒绝构建，非 OFL 字体不得走该归一化路径。

每个家族输出原始完整许可文件及独立归属 JSON；后者保存原字体 name0 版权、商标、厂家、设计者、name13/14、固定来源和修改说明。所有派生字体都改为 `WYF1-<sourceFontHashPrefix>-<shard>` 内部 family／PostScript 名，CFF 名称也同步改写，避免沿用 Reserved Font Name。派生字体菜单也不沿用 RFN：`wenkai` 展示为“文楷”；归属 JSON 的 `upstreamName` 独立保留“霞鹜文楷”作为原始来源信息，不作为派生主名称。

用户提供的 BOOTH 原始 ZIP 作为固定上游输入，经 ZIP 与内部字体双层哈希核验；`--source-dir` 使后续构建不依赖登录。侵食明朝与冒险黑体使用 ZIP 中的完整 OFL 文件。白光明朝 ZIP 不含独立许可文件，授权依据是原字体 name13/14 与[作者官方页](https://lavsic.booth.pm/items/8292561) 的 OFL 1.1 声明；构建附固定 Adobe 上游的完整 OFL 文本，并独立保留该字体原始 Adobe 版权，源锁明确其文本来源，不声称 ZIP 含不存在的文件。

小城拉风体的依据是负责人本轮确认已取得本项目使用授权，非 OFL，未虚构独立授权文书。源文件取得和完整性核验前保持 `pendingSource`。未明确获得字体修改权前不对其执行改名、子集化或格式转换；完整原字库的嵌入与再分发路径、体积和单独预算必须据实记录后才能成为 `ready`。不能以其他家族的 OFL 替代它的授权。

## 固定分片与成本

OFL 构建只在发布准备阶段运行。`core` 固定为 GB2312 一级汉字 3755 个，加可打印 ASCII 95 个及清单中标点，与源 cmap 取交集；其余字符按 Unicode 2048 码位页划分，覆盖扩展平面。分片互不重叠，所有源 cmap 字符恰好落入一片。不是按帖子、读者、请求或正文内容动态生成。

每片由同一子集生成 WOFF2 和移动 SFNT（原始轮廓是 CFF 时保留 OTF，否则 TTF），分片记录 `unicodeRanges`、实际字符数及两个平台各自的 SHA-256、字节数和 MIME。每个 OFL 家族的派生 face 元数据统一为 `baseWeight: 400` / `baseStyle: normal`（Regular）；只归一化字重／斜体元数据，不改变原有笔画风格。原始字重、fsSelection、macStyle 和 italicAngle 保存在归属文件中。Web／Flutter 根据独立的粗体、斜体标记合成，真实引擎效果仍需消费者实际验收。

完整 coverage 同时报告 ASCII、GB2312 和常见标点的命中／缺失；不伪造缺失字形，不以少量缺字淘汰已选定风格。客户端将缺失字符交给系统字体。

Web 按正文实际字符和可见范围选择所需分片，使用 `FontFace` 和覆盖信息加载，避免给全目录注入可自动并发下载的 `@font-face` 样式。Mobile 只下载并注册相同固定分片，以分片唯一 family 名构造 fallback；不能因为一个罕见字就载入整家族全集。Flutter 字体注册通常不能可靠卸载，离开页面不清零进程内预算；超过注册上限继续系统回退，不能按页面重置计数。

manifest 的 `limits` 是消费者必须遵守的上限，不是后台承诺已经计费或具有云端断流能力：

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

## 本批实测结果

当前 17 个登记家族中 16 个为 `ready`，小城拉风体仍待原件。固定原始源容器共 177,946,103 字节；16 个可用家族生成 659 片，对应 Web WOFF2 共 72,870,824 字节、Mobile SFNT 共 142,063,608 字节。去重后的字体及许可归属共 1,352 个对象；加上 3,207,159 字节的 manifest，实际发布引用集合为 1,353 个对象、218,247,414 字节。全目录大小仅用于发布成本核算，客户端不得预加载全集。

16 个 `core` 的合计大小分别为 Web 14,808,412 字节、Mobile 27,927,900 字节；最大的单片分别为 1,548,272／2,663,364 字节，均是龙藏体 `core`。客户端仍须依实际选择执行家族、字节、请求和注册上限。manifest 的 SHA-256 为 `ad22427e048b90f798bddafc308195786600ee006459f54144610d1bbe35d5c3`，与生成索引逐字节核验一致。

覆盖来自实际 cmap；以下风格存在缺字，其余 11 款 GB2312 的 6,763 字均齐全：

| 家族 | GB2312 命中 / 6,763 | 可打印 ASCII 命中 / 95 | 常用标点命中 / 20 |
| --- | --- | --- | --- |
| 缝合像素 | 6,635 | 95 | 20 |
| 侵食明朝 | 4,546 | 95 | 20 |
| 冒险黑体 | 3,385 | 95 | 20 |
| 白光明朝 | 4,547 | 95 | 20 |
| 敬峰中山王篆 | 2,832 | 18 | 7 |

站酷小薇体、龙藏体和流江毛草的常用标点各为 19/20，其余未列字体的 ASCII 与常用标点齐全。精确缺失码位见 manifest 的 `missingRanges`，显示时按字符回退，不能因家族为 `ready` 就假定所有文字都有专用字形。

侵食明朝已锁原件的 GDEF 使用 1.0 布局结构但误写版本 0。构建只把该版本修正为 1.0，保留原有 mark class 与布局数据，并在归属 `tableRepairs` 记录；未知扩展结构拒绝修复。回归覆盖 classes 保留、未知结构拒绝和正常原件不变。两片受影响的实际 SFNT/WOFF2 均已验证从原件直接构建与修复已有子集逐字节一致。

验证使用 Python 3.12.3、fontTools 4.46.0、Brotli 1.1.0；13 项离线单元测试、JSON 契约检查及全部资产的 SHA-256／长度／cmap／命名／基础样式校验通过。真实 TTF 与 CFF 各一片的直接重建和命名迁移结果逐字节一致。Chromium 实际成功解码 16 家族的 32 个 `core` 资产，以及侵食修复片的 4 个资产，没有字体警告；该结果只确认浏览器加载与 canvas 可用，不代表 Flutter 设备、粗斜体视觉效果或峰值内存已验收。

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

`fetch.py` 是明确的上游只读下载入口；构建默认全离线，只有显式 `--download` 才读取锁源 HTTPS。缓存命中仍检查大小与完整哈希；版本、许可、archive member、嵌入权限标志、cmap、命名、大小与任何资产校验失败都会停止，不生成可发布的新 manifest。构建固定工具版本和 OpenType 时间戳；测试实际验证相同输入重复生成逐字节一致的 SFNT/WOFF2。

输出 `fonts/v1/<完整SHA-256>.<扩展名>`、完整 manifest 和 `release-review.json`。发布审查使用新的独立目录，只复制最终 manifest 引用的字体、许可、归属及 manifest 本身；不把 checkpoint、旧 manifest 或未引用资产整目录上传。最后两个文件在全部家族及资产核验完成后写入；中断仅留下可复验 checkpoint 与内容寻址资源，不视为成功发布。恢复构建重新校验 checkpoint 的全部文件。

经独立合并及发布授权后，运营步骤应为：离线复验完整包 → 核验自有存储／CDN 容量和月流出硬上限 → 上传内容寻址资源及全部许可归属 → 对照完整 manifest 核验每个对象字节／哈希／MIME → 上传 manifest → 只读校验缓存、CORS 和错误回退 → 配置自有 base URL → 单独批准启用新写。不覆盖既有 hash 路径，不删除旧资源兼容，不使用第三方源作为运行时兜底。

字体与 manifest 返回 `Cache-Control: public, max-age=31536000, immutable`、基于内容哈希的强 ETag、准确 Content-Type、`X-Content-Type-Options: nosniff`，跨域读取只允许审核过的客户端 origin（不带凭证）。客户端先校验 manifest 描述符；首次取得一个家族时同时取得并核验该家族的 `notices`，让完整许可／归属随离线字体缓存保存，展示归属时明确原始来源名。许可文件按内容哈希共用，通知文件请求同样计入请求预算。再校验字体实际长度和完整 SHA-256 后才能缓存／注册；304 只能复用已经验证的本地条目，损坏缓存删除后最多一次重试，失败进入本次会话回退，防止请求风暴。

测试只使用自行生成的测试字形与临时目录，不涉及数据库、Redis、上传桶或线上账号。此资源流程的本地文件写入不代表已执行正文保存 E2E；正文链路仍按 [隔离规则](e2e-isolation.md) 验证。
