import { PrismaClient } from '@prisma/client';
import { inspectImage } from '../common/image-inspection';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MAX_STATIC_INPUT_PIXELS } from './media-image-inspection';

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
type Dimensions = { width: number | null; height: number | null; animated: boolean };
export type GifAuditRecord =
  | { kind: 'candidate'; mediaId: string; before: Dimensions; after: Dimensions }
  | { kind: 'skipped'; mediaId: string; reason: 'oversize' | 'unavailable-or-invalid' };

/** 仅产生审核计划；不提供 apply，也不把对象键、URL、原始异常或身份写入输出。 */
export async function auditGifMetadata(
  prisma: Pick<PrismaClient, 'media'>,
  storage: Pick<ObjectStorageService, 'download'>,
  emit: (record: GifAuditRecord) => void,
  options: { limit?: number; after?: string } = {},
) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('AUDIT_LIMIT_INVALID');
  let cursor = options.after;
  let scanned = 0;
  let candidates = 0;
  let skipped = 0;
  while (scanned < limit) {
    const rows = await prisma.media.findMany({
      where: {
        contentType: 'image/gif',
        status: 'COMPLETED',
        deletionClaimedAt: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, key: true, size: true, width: true, height: true, animated: true },
      orderBy: { id: 'asc' },
      take: Math.min(50, limit - scanned),
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      cursor = row.id;
      scanned++;
      if (row.size !== null && row.size > MAX_SOURCE_BYTES) {
        skipped++;
        emit({ kind: 'skipped', mediaId: row.id, reason: 'oversize' });
        continue;
      }
      try {
        const source = await storage.download(row.key, undefined, MAX_SOURCE_BYTES);
        const image = await inspectImage(source, { limitInputPixels: MAX_STATIC_INPUT_PIXELS });
        if (image.format !== 'gif') throw new Error('IMAGE_TYPE_MISMATCH');
        const before = { width: row.width, height: row.height, animated: row.animated };
        const after = { width: image.frameWidth, height: image.frameHeight, animated: true };
        if (
          before.width !== after.width ||
          before.height !== after.height ||
          before.animated !== after.animated
        ) {
          candidates++;
          emit({ kind: 'candidate', mediaId: row.id, before, after });
        }
      } catch {
        skipped++;
        emit({ kind: 'skipped', mediaId: row.id, reason: 'unavailable-or-invalid' });
      }
    }
  }
  return {
    kind: 'summary' as const,
    mode: 'read-only' as const,
    scanned,
    candidates,
    skipped,
    nextAfter: cursor ?? null,
  };
}
