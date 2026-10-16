# 音频资源预算候选验收

基线 `origin/dev=1aa8655f7c8e25dcc8723d7793afb9cefc6d510d`；独立任务 `codex/20261017-audio-resource-budget`，Worktree `/srv/wenyousite/worktrees/backend-audio-resource-budget`。契约源 `9159729106cefb883726121dc9f94c0b164678c1`，只读核验CLI源 `2ed14224b3a99c8beeff187908f4aa6c7b8915a0`。成功响应/Markdown不变，仅增加42901/42902；Foundation无视觉/语义资产变化，不需要发布Tag。

## 变更与限制

- 默认活动2份、UTC日新签发输入预留300MiB，可配置；保留30MiB/600秒/128kbps/10MiB输出。
- PostgreSQL用户行 `FOR NO KEY UPDATE` 在同一事务串行准入。新输入字节独立字段保留原值，转码不改；每日额度不会因失败/过期/输出变小释放。同mediaId重签、确认不重复扣。
- UPLOADING租约15分钟，过期释放活动名额；晚确认/重签原子重新申请。Media行锁和回收领取互斥，旧上传续租后不再被24小时候选领取。PROCESSING不按年龄放行，现有队列恢复继续负责。
- 加法迁移增加两个内部nullable字段与索引，回填仍在途音频的已知输入size；历史完成记录输入未知，不猜测。内部字段不进入成功DTO。
- 准入不是实际桶PUT流量计量；有效签名可重复PUT。日额度按UTC重置，错误提示不暗示本地午夜。没有新增取消接口，放弃上传的名额最多保留租约时长。
- 只读CLI不启动应用或连接Redis/对象存储。只读DB聚合不能证明桶内每个对象的存在/清理状态。没有持久化的恢复任务最近成功指标，不能据service active或无错误事件声称恢复任务健康。

## 定向检查

开发反馈阶段按用户要求，未运行全量测试、全量分析、完整构建或门禁。后续用户授权合并后的门禁记录见下文。

- OpenAPI从源生成，248操作结构校验与版本校验通过；相关fixture同版本元数据同步5.38.0-dev.20261017.1。错误码文档生成通过。
- `jest --runInBand` 仅 `audio-budget.service.spec.ts`、`media.service.spec.ts`、`media-processing.service.spec.ts`、`media-processing-recovery.service.spec.ts`、`configuration.spec.ts`：5套70项通过。覆盖预算拒绝、重复确认、内部字段不透出、配置整数限制及原有失败staging/恢复路径。
- `tsx --test scripts/audio-resource-audit.test.ts`：1项通过；验证第一条语句READ ONLY、兼容旧schema、不冒称队列健康。CLI `--help`通过。
- ESLint仅9个受影响应用/配置/test文件通过。TypeScript仅新预算集成与3个审计脚本入口及其依赖图检查通过（`.cache/tsconfig.audio-budget.json`）；不是仓库全量typecheck。
- 两轮 `scripts/audio-budget.integration.ts` 使用本轮独立PostgreSQL/Redis、随机账号、应用DB角色；对象存储/队列用内存替身，未访问真实桶、邮件、推送或公网业务写入。迁移只在临时集群执行。
- 首轮验证8并发只2成功、每日预算并发、UTC日界、输入不可变、过期/晚确认、同ID恢复、历史nullable、队列失败补偿和回收先领取；第二轮增加续租/晚确认先持锁、回收等待并最终放弃。只读审计在同一隔离库实际执行。

| 轮次 | runId | 私有根目录 | PG / Redis端口 | 结果 |
| --- | --- | --- | --- | --- |
| 初轮 | e2e_8fd30c42ca3fda60aee9aa44 | /tmp/wenyousite-e2e-QGQn1t | 41065 / 33709 | 通过，清理true |
| 最终 | e2e_b72a77b917548b98887d9d05 | /tmp/wenyousite-e2e-IPvVf4 | 38661 / 37531 | 通过，清理true |

两轮均输出resourcesVerified/resourcesCleaned=true，结束后独立核对两目录不存在、4端口全部关闭。Redis实例分别为 `b2862d7945389a986be4811dfc560d592713136f`、`1b755cbdd7b28de1e30bf747d66eef6c0057e850`。

任务忽略日志保留：`.cache/audio-budget-final-unit.log` SHA256 `1cb0604c2e6b5f2a2839eb0cf16fd877b55b5c0af4e91564328603006f8f7ab3`；`.cache/audio-budget-final-integration.log` SHA256 `aa1f1c8de878e3dcb06fae4d58b2a2ad1a1d0c90925d9844317ee12dee5a6e9c`；初轮集成SHA256 `20c1e34f0dffb33ea95c8feec85a04c6f5922013b70cd95596f682a4bfba0558`。

## 线上只读观察（治理管理身份提供）

2026-10-16T18:09:45.731Z（北京时间10月17日02:09:45）已提交CLI执行成功：线上仍是预算迁移前schema；音频总5/完成5/正文或草稿引用2，上传中0、处理中0、失败0、完成和失败staging残留均0、7日孤儿候选0、回收已领取0。只读查询，没有cleanup/reconcile/delete。

配置文件与API/Worker实际进程环境白名单均显示音频开启，完成孤儿回收未设置且默认false，小时配额未设且默认60；两服务active/running、NRestarts=0。完成孤儿7日删除当前未开启，本任务不改变，未来启用需独立决定及既有前置引用审计。

最近24小时管理日志精确匹配MediaService「孤儿图片清理完成」事件1条，最近UTC2026-10-16T04:00:01.169867（北京时间12:00）；清理失败、初始恢复失败、重入队、跳过事件均0。只记录聚合，不输出原始日志/身份/URL；恢复任务最近成功时间仍未知；此事件不是CleanupTask整体成功证明，也不代表音频实际被删除。

## 交付边界

开发候选提交含 `[skip ci]`，仅交付评审。用户随后明确授权合并与任务清理，进入正常门禁阶段；不包含部署、线上迁移、开关或业务资源清理。


## 授权合并门禁

本次应用源码固定为 `5b10e725184684d7a4e651ff9c54ec5893c5a261`，基线仍为上述 `origin/dev`。追加本记录的提交只修改文档，恢复 PR 的正常 quality CI，不改写已共享历史。

在任务 Worktree 运行 `pnpm check:full`，仅该进程取消失效的本机代理环境变量；固定哈希音频运行依赖准备到任务缓存，没有系统安装或共享 PATH 变更。隔离工具为 `/opt/wenyousite/e2e-tools/usr/lib/postgresql/16/bin`、`/opt/wenyousite/e2e-tools/usr/bin/redis-server` 和对应私有依赖库目录。

提交本记录时：安全审计、lint、类型、架构、契约、207套/2666项 Jest、入口/发布脚本夹具、文档、构建、真实清理集成与隔离生命周期均已通过；完整 API E2E 和最后的音频预算隔离集成仍在运行。最终结果、runId、清理核验及日志 SHA256 在 PR 合并记录中补充，未完成前不得合并。完整日志保留于 `.cache/audio-budget-merge-check-full.log`，清理 Worktree 前归档到外部私有证据目录。

已检查 workflow 及仓库 hooks：dev 推送触发 quality 检查，未发现自动部署入口；最终合并前再次 fetch 并核对目标基线与 head，required checks 通过后才合并。Web 本轮还需此已构建 checkout 运行独立 E2E，收到其清理完成/释放通知后才移除 Worktree。
