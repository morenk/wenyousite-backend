import { Prisma, PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';

export interface DisplayBackfillOptions { apply?: boolean; limit?: number; after?: string }

/** 只扫描有存活引用的历史 GIF；默认只输出计划，永不内联解码或扫描整个存储桶。 */
export async function planDisplayBackfill(
  prisma: Pick<PrismaClient, 'media'>, queue: Pick<Queue, 'getJob' | 'add'> | null,
  options: DisplayBackfillOptions, emit: (record: Record<string, unknown>) => void,
) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('DISPLAY_BACKFILL_LIMIT_INVALID');
  if (options.after && !/^[a-zA-Z0-9_-]{1,128}$/.test(options.after)) throw new Error('DISPLAY_BACKFILL_CURSOR_INVALID');
  if (options.apply && !queue) throw new Error('DISPLAY_BACKFILL_QUEUE_REQUIRED');
  const rows = await prisma.media.findMany({ where: {
    status: 'COMPLETED', deletionClaimedAt: null,
    AND: [{ OR: [{ contentType: 'image/gif' }, { contentType: null, animated: true }] }],
    displayAsset: { equals: Prisma.DbNull },
    ...(options.after ? { id: { gt: options.after } } : {}),
    OR: [{ avatarUser: { isNot: null } }, { profileCoverUser: { isNot: null } }, { profileCoverMobileUser: { isNot: null } }, { directMessage: { recalledAt: null } },
      { momentImages: { some: { moment: { deletedAt: null } } } }, { momentCovers: { some: { deletedAt: null } } },
      { momentComment: { deletedAt: null } },
      { postAttachments: { some: { post: { deletedAt: null, subthread: { deletedAt: null }, thread: { deletedAt: null } } } } },
      { draftAttachments: { some: {} } }],
  }, select: { id: true, displayStatus: true, displayAttempts: true, displayStartedAt: true },
  orderBy: { id: 'asc' }, take: limit + 1 });
  const hasMore = rows.length > limit;
  const batch = rows.slice(0, limit);
  let enqueued = 0;
  for (const row of batch) {
    let action = row.displayAttempts >= 3 ? 'EXHAUSTED' :
      row.displayStatus === 'PROCESSING' && row.displayStartedAt && row.displayStartedAt.getTime() > Date.now() - 5 * 60_000
        ? 'IN_PROGRESS' : 'ELIGIBLE';
    if (options.apply && action === 'ELIGIBLE') {
      const jobId = 'display-' + row.id;
      const job = await queue!.getJob(jobId);
      const state = job ? await job.getState() : 'missing';
      if (['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)) action = 'QUEUED';
      else {
        if (job && ['failed', 'completed'].includes(state)) await job.remove();
        else if (job) { emit({ mediaId: row.id, action: 'QUEUE_STATE_SKIPPED' }); continue; }
        await queue!.add('display-backfill', { mediaId: row.id }, { jobId, attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true, removeOnFail: 100 });
        enqueued++;
        action = 'ENQUEUED';
      }
    }
    emit({ mediaId: row.id, action, attempts: row.displayAttempts });
  }
  return { mode: options.apply ? 'apply' : 'dry-run', scanned: batch.length, enqueued,
    hasMore, nextCursor: batch.at(-1)?.id ?? null };
}

/** 运维参数在连接数据库之前完整校验，遗漏值或重复参数不能退回默认第一页。 */
export function parseDisplayBackfillArgs(args: string[]): DisplayBackfillOptions {
  const result: DisplayBackfillOptions = {};
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (!['--apply', '--limit', '--after'].includes(argument) || seen.has(argument)) throw new Error('DISPLAY_BACKFILL_ARGUMENT_INVALID');
    seen.add(argument);
    if (argument === '--apply') { result.apply = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('DISPLAY_BACKFILL_ARGUMENT_INVALID');
    if (argument === '--limit') {
      result.limit = Number(value);
      if (!Number.isSafeInteger(result.limit) || result.limit < 1 || result.limit > 1000) throw new Error('DISPLAY_BACKFILL_LIMIT_INVALID');
    } else {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('DISPLAY_BACKFILL_CURSOR_INVALID');
      result.after = value;
    }
  }
  return result;
}
