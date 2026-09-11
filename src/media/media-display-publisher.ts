import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Media, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { generateAnimationDisplay } from './media-animation-display';
import { animationDisplayKey, DISPLAY_UPLOAD_MS } from './media-animation-display-policy';
import { readMediaDisplay } from './media-display';

/** 完整展示是必需产物；独立 key 与先记账/后上传避免中断和并发造成失联对象。 */
export async function ensureAnimationDisplay(
  prisma: PrismaService, storage: ObjectStorageService, media: Pick<Media, 'id' | 'key' | 'displayAsset'>, source: Buffer,
) {
  const existing = readMediaDisplay(media.displayAsset);
  if (existing) return existing;
  const encoded = await generateAnimationDisplay(source);
  const attemptId = randomUUID();
  const key = animationDisplayKey(media.key, attemptId);
  const expiresAt = new Date(Date.now() + DISPLAY_UPLOAD_MS);
  await prisma.$transaction(async (tx) => {
    // 与孤儿领取更新同一行串行：删除先领取则禁止登记和 PUT。
    const locked = await tx.media.updateMany({ where: {
      id: media.id, key: media.key, deletionClaimedAt: null,
      status: { in: ['PROCESSING', 'COMPLETED'] },
    }, data: { key: media.key } });
    if (locked.count !== 1) throw new Error('DISPLAY_MEDIA_UNAVAILABLE');
    await tx.mediaPreviewAttempt.create({ data: {
      id: attemptId, mediaId: media.id, keys: [key], expiresAt,
      nextCleanupAt: new Date(expiresAt.getTime() + 30_000),
    } });
  });
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      storage.upload(key, encoded.body, { contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable', abortSignal: abort.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new Error('DISPLAY_UPLOAD_TIMEOUT')); }, DISPLAY_UPLOAD_MS);
      }),
    ]);
    const descriptor = {
      url: storage.publicUrl(key), contentType: 'image/webp' as const,
      width: encoded.width, height: encoded.height, bytes: encoded.body.length,
      animated: encoded.frameCount > 1, frameCount: encoded.frameCount,
      durationMs: encoded.durationMs, loopCount: encoded.loopCount,
    };
    const published = await prisma.$transaction(async (tx) => {
      const claim = await tx.mediaPreviewAttempt.updateMany({
        where: { id: attemptId, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'PUBLISHED' },
      });
      if (claim.count !== 1) return false;
      const updated = await tx.media.updateMany({ where: {
        id: media.id, key: media.key, status: { in: ['PROCESSING', 'COMPLETED'] },
        deletionClaimedAt: null, displayAsset: { equals: Prisma.DbNull },
      }, data: { displayAsset: descriptor, displayStatus: 'READY', displayStartedAt: null, displayFailureCode: null } });
      if (updated.count !== 1) {
        await tx.mediaPreviewAttempt.updateMany({ where: { id: attemptId, status: 'PUBLISHED' }, data: { status: 'PENDING' } });
      }
      return updated.count === 1;
    });
    if (published) return descriptor;
    const current = await prisma.media.findFirst({
      where: { id: media.id, deletionClaimedAt: null, status: { in: ['PROCESSING', 'COMPLETED'] } },
      select: { displayAsset: true },
    });
    const winner = readMediaDisplay(current?.displayAsset);
    if (winner) return winner;
    throw new Error('DISPLAY_PUBLICATION_CONFLICT');
  } finally {
    if (timer) clearTimeout(timer);
    abort.abort();
  }
}

/** 历史媒体保留 COMPLETED；独立租约与三次累计尝试避免丢失队列或反复点击造成无限转码。 */
export async function processHistoricalDisplay(prisma: PrismaService, storage: ObjectStorageService, mediaId: string) {
  const media = await prisma.media.findFirst({ where: {
    id: mediaId, status: 'COMPLETED', deletionClaimedAt: null,
    OR: [{ contentType: 'image/gif' }, { contentType: null, animated: true }],
    displayAsset: { equals: Prisma.DbNull }, displayAttempts: { lt: 3 },
  } });
  if (!media) return;
  const cutoff = new Date(Date.now() - 5 * 60_000);
  const claimed = await prisma.media.updateMany({ where: {
    id: media.id, status: 'COMPLETED', deletionClaimedAt: null,
    displayAsset: { equals: Prisma.DbNull }, displayAttempts: media.displayAttempts,
    OR: [{ displayStatus: null }, { displayStatus: 'FAILED' },
      { displayStatus: 'PROCESSING', displayStartedAt: { lt: cutoff } }],
  }, data: { displayStatus: 'PROCESSING', displayStartedAt: new Date(), displayAttempts: { increment: 1 }, displayFailureCode: null } });
  if (claimed.count !== 1) return;
  const started = Date.now();
  const logger = new Logger('MediaDisplayBackfill');
  try {
    const source = await storage.download(media.key);
    const display = await ensureAnimationDisplay(prisma, storage, media, source);
    logger.log(`media_display_backfill_complete mediaId=${media.id} displayMs=${Date.now() - started} displayBytes=${display.bytes} attempt=${media.displayAttempts + 1}`);
  } catch (error) {
    const failureCode = error instanceof Error && /^(DISPLAY|IMAGE|GIF|ANIMATED_IMAGE)_[A-Z_]{1,64}$/.test(error.message)
      ? error.message : 'DISPLAY_PROCESSING_FAILED';
    logger.warn(`media_display_backfill_failed mediaId=${media.id} displayMs=${Date.now() - started} failureCode=${failureCode} attempt=${media.displayAttempts + 1}`);
    await prisma.media.updateMany({ where: { id: media.id, displayStatus: 'PROCESSING', displayAttempts: media.displayAttempts + 1 },
      data: { displayStatus: 'FAILED', displayStartedAt: null, displayFailureCode: failureCode } });
    throw error;
  }
}
