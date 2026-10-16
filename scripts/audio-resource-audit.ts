import { Prisma, PrismaClient } from '@prisma/client';

/** 只输出数量和年龄。事务在第一条数据查询前设为 READ ONLY，不初始化应用/队列。 */
export async function auditAudioResources(db: PrismaClient, completedCleanupEnabled: boolean) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
    const [mode] = await tx.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
    if (mode.transaction_read_only !== 'on') throw new Error('READ_ONLY_REQUIRED');
    const fields = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'media' AND column_name IN ('audio_upload_lease_until','audio_input_bytes')`;
    const budgetSchema = Number(fields[0].count) === 2;
    const activeLease = budgetSchema
      ? Prisma.sql`COALESCE(m.audio_upload_lease_until, m.created_at + interval '15 minutes') > CURRENT_TIMESTAMP`
      : Prisma.sql`m.created_at + interval '15 minutes' > CURRENT_TIMESTAMP`;
    const noReference = Prisma.sql`NOT EXISTS (SELECT 1 FROM post_media p WHERE p.media_id=m.id) AND NOT EXISTS (SELECT 1 FROM draft_media d WHERE d.media_id=m.id)`;
    const [summary] = await tx.$queryRaw<Record<string, bigint | Date | number | null>[]>(Prisma.sql`
      SELECT CURRENT_TIMESTAMP AS observed_at,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='UPLOADING') AS uploading,
        COUNT(*) FILTER (WHERE status='UPLOADING' AND NOT (${activeLease})) AS expired_upload_leases,
        COUNT(*) FILTER (WHERE status='UPLOADING' AND m.created_at < CURRENT_TIMESTAMP-interval '24 hours' AND NOT (${activeLease})) AS uploading_24h_candidates,
        COUNT(*) FILTER (WHERE status='PROCESSING') AS processing,
        COUNT(*) FILTER (WHERE status='PROCESSING' AND (processing_started_at IS NULL OR processing_started_at < CURRENT_TIMESTAMP-interval '15 minutes')) AS processing_stale,
        MAX(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-COALESCE(processing_started_at,created_at)))) FILTER (WHERE status='PROCESSING')::float AS oldest_processing_seconds,
        COUNT(*) FILTER (WHERE status='COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE status='FAILED') AS failed,
        COUNT(*) FILTER (WHERE status='COMPLETED' AND staging_key IS NOT NULL) AS completed_staging_pending,
        COUNT(*) FILTER (WHERE status='FAILED' AND staging_key IS NOT NULL) AS failed_staging_pending,
        COUNT(*) FILTER (WHERE status='COMPLETED' AND orphaned_at < CURRENT_TIMESTAMP-interval '7 days' AND ${noReference}) AS completed_orphan_7d_candidates,
        COUNT(*) FILTER (WHERE status='FAILED' AND created_at < CURRENT_TIMESTAMP-interval '7 days' AND ${noReference}) AS failed_7d_candidates,
        COUNT(*) FILTER (WHERE deletion_claimed_at IS NOT NULL) AS deletion_claimed,
        COUNT(*) FILTER (WHERE NOT (${noReference})) AS referenced
      FROM media m WHERE purpose='RICH_CONTENT_AUDIO'
    `);
    return { version: 1, readOnly: true, budgetSchema, completedOrphanCleanupEnabled: completedCleanupEnabled,
      summary: Object.fromEntries(Object.entries(summary).map(([key,value]) => [key, typeof value === 'bigint' ? value.toString() : value])),
      recovery: { intervalSeconds: 600, staleAfterSeconds: 900, lastSuccessfulRun: 'not-exposed', queueHealth: 'not-queried' },
      scope: 'DB aggregate only; candidate counts are not deletion authorization or object-existence proof' };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}
