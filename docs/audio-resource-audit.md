# 音频资源只读核验

使用已提交脚本和当前已安装依赖，管理员在任务 checkout 执行：

```sh
pnpm exec tsx scripts/audit-audio-resources.ts --env /etc/wenyousite/backend.env
```

此入口只读应用角色 DATABASE_URL 和完成孤儿回收开关，拒绝可被其他身份改写的配置文件；不输出连接串、用户、mediaId、URL、对象键或正文。PostgreSQL 可重复读事务首先设 READ ONLY，查询5秒/锁1秒/事务15秒上限。输出状态数、15分钟租约过期数、24小时上传候选、15分钟滞留处理数及最大年龄、完成/失败临时对象残留数、7日孤儿候选和引用数。兼容预算迁移尚未部署的schema，`budgetSchema=false`时上传租约仅按创建时间估计。没有apply，不调用Nest生命周期、Redis、存储、reconcile或cleanup。候选只按音频正文/草稿关系统计，不是最终删除授权，也不证明桶中对象实际存在或不存在。

定时调度事实源：`JobsModule` 注册 `CleanupTask` 和 `MediaProcessingRecoveryService`。前者每天进程时区04:00调用媒体回收；后者启动时及每10分钟核对15分钟以上PROCESSING与队列状态。恢复对waiting/active/delayed任务保留，对failed标记失败，对missing/completed重新入队；本核验绝不调用这些动作。

当前调度没有持久化最近成功时间，CLI明确输出 `lastSuccessfulRun=not-exposed`、`queueHealth=not-queried`。service active不能代替任务成功；治理可只读从管理日志筛选固定事件文字并仅输出计数/时间范围，禁止dump原日志或根据无错误记录推断健康。若无法证实最近一次运行，交付记录标记未知。

2026-10-17治理已按配置文件和实际API/Worker进程环境白名单核验：音频开启，完成孤儿回收开关未设置、代码默认false，小时配额默认60；两个service active/running且NRestarts=0。这只证明服务/配置状态。完成音频孤儿不会自动按7日删除，开启需要独立决定和原有前置引用审计；本任务不改开关、不回收线上对象。
