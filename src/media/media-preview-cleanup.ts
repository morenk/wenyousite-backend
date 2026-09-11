import { animationDisplayKey } from './media-animation-display-policy';

import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { animationPreviewKey, PREVIEW_EDGES } from './media-animation-preview-policy';

const RETRY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 未发布尝试使用独立对象 key；成功清理也保留墓碑，以补偿超时后的迟到 PUT。 */
export async function cleanupMediaPreviewAttempts(
  prisma: PrismaService, storage: ObjectStorageService, limit = 20,
): Promise<number> {
  const now = new Date();
  const rows = await prisma.mediaPreviewAttempt.findMany({
    where: { status: { in: ['PENDING', 'CLEANING'] }, nextCleanupAt: { lte: now },
      expiresAt: { lte: now }, media: { status: { in: ['COMPLETED', 'FAILED'] } } },
    orderBy: { nextCleanupAt: 'asc' }, take: Math.min(100, Math.max(1, limit)),
    include: { media: { select: { key: true } } },
  });
  let cleaned = 0;
  for (const row of rows) {
    const allowed = new Set(PREVIEW_EDGES.map((edge) => animationPreviewKey(row.media.key, row.id, edge)));
    allowed.add(animationDisplayKey(row.media.key, row.id));
    if (!row.keys.length || row.keys.some((key) => !allowed.has(key))) continue;
    const leaseUntil = new Date(Date.now() + RETRY_MS);
    const claimed = await prisma.mediaPreviewAttempt.updateMany({
      where: { id: row.id, status: row.status, nextCleanupAt: row.nextCleanupAt,
        expiresAt: { lte: new Date() } },
      data: { status: 'CLEANING', nextCleanupAt: leaseUntil },
    });
    if (claimed.count !== 1) continue;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let success = false;
    try {
      await Promise.race([
        Promise.all(row.keys.map((key) => storage.remove(key, undefined, abort.signal))),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { abort.abort(); reject(new Error('preview_cleanup_deadline')); }, 2_000);
        }),
      ]);
      success = true;
      cleaned++;
    } catch {
      abort.abort();
    } finally {
      if (timer) clearTimeout(timer);
    }
    // 成功后 1、2、4、7 天退避复查；失败仍十分钟重试，不周期性轰炸对象存储。
    const nextDelay = success ? Math.min(7, 2 ** Math.min(row.cleanupPasses, 3)) * DAY_MS : RETRY_MS;
    await prisma.mediaPreviewAttempt.updateMany({
      where: { id: row.id, status: 'CLEANING', nextCleanupAt: leaseUntil },
      data: { nextCleanupAt: new Date(Date.now() + nextDelay),
        ...(success ? { cleanupPasses: { increment: 1 } } : {}) },
    });
  }
  return cleaned;
}
