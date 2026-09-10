
import { randomUUID } from 'node:crypto';
import { Media, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { generateAnimationPreviews } from './media-animation-preview';
import {
  animationPreviewKey, PreviewDescriptor, PREVIEW_BUDGET_MS, PREVIEW_JOB_BUDGET_MS,
  supportsAnimationPreview,
} from './media-animation-preview-policy';

export type PendingMediaPreviews = { attemptId: string | null; variants: PreviewDescriptor[] | null; deadline?: number };
const empty = (): PendingMediaPreviews => ({ attemptId: null, variants: null });

/** 截止时间包括队列年龄、编码槽等待、两档编码和对象上传。 */
export async function stageOptionalPreviews(
  prisma: PrismaService, storage: ObjectStorageService,
  media: Pick<Media, 'id' | 'key' | 'purpose' | 'processingStartedAt'>,
  source: Buffer, jobStartedAt: number,
): Promise<PendingMediaPreviews> {
  if (!supportsAnimationPreview(media.purpose)) return empty();
  const now = Date.now();
  const startedAt = Math.min(jobStartedAt, media.processingStartedAt?.getTime() ?? jobStartedAt);
  const deadline = Math.min(now + PREVIEW_BUDGET_MS, startedAt + PREVIEW_JOB_BUDGET_MS);
  if (deadline - now < 1_000) return empty();
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(new Error('preview_deadline')); },
      Math.max(0, deadline - Date.now()));
  });
  try {
    const variants = await Promise.race([generateAnimationPreviews(source, deadline), timeout]);
    if (!variants.length || Date.now() >= deadline) return empty();
    const attemptId = randomUUID();
    const keys = variants.map((variant) => animationPreviewKey(media.key, attemptId, variant.edge));
    // 先记精确 key 再 PUT；工作进程中断也不会失去补偿依据。
    await Promise.race([prisma.mediaPreviewAttempt.create({ data: {
      id: attemptId, mediaId: media.id, keys, expiresAt: new Date(deadline),
      nextCleanupAt: new Date(deadline + 30_000),
    } }), timeout]);
    if (Date.now() >= deadline) return empty();
    const uploads = Promise.all(variants.map((variant, index) => storage.upload(keys[index], variant.body, {
      contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable',
      abortSignal: abort.signal,
    })));
    await Promise.race([uploads, timeout]);
    if (Date.now() >= deadline) return empty();
    return { attemptId, deadline, variants: variants.map((variant, index) => ({
      url: storage.publicUrl(keys[index]), width: variant.width, height: variant.height,
      bytes: variant.body.length,
    })) };
  } catch {
    // 原件和必需首帧已成功，附加优化失败不能把合法上传变为 FAILED。
    abort.abort();
    return empty();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 与完成状态同事务发布，清理任务拿到旧快照后仍须通过相同状态 CAS。 */
export async function completeMediaWithPreviews(
  prisma: PrismaService, mediaId: string, data: Prisma.MediaUpdateManyMutationInput,
  previews: PendingMediaPreviews,
) {
  const where = { id: mediaId, status: 'PROCESSING' as const, deletionClaimedAt: null };
  const completeBase = () => prisma.media.updateMany({ where, data: { ...data, previewVariants: Prisma.DbNull } });
  const remaining = (previews.deadline ?? Date.now() + PREVIEW_BUDGET_MS) - Date.now();
  if (!previews.attemptId || !previews.variants || remaining <= 250) return completeBase();
  try {
    return await prisma.$transaction(async (tx) => {
    const published = await tx.mediaPreviewAttempt.updateMany({
      where: { id: previews.attemptId!, mediaId, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: { status: 'PUBLISHED' },
    });
    const completed = await tx.media.updateMany({ where, data: {
      ...data,
      previewVariants: published.count === 1 ? previews.variants as Prisma.InputJsonArray : Prisma.DbNull,
    } });
    if (completed.count !== 1 && published.count === 1) {
      await tx.mediaPreviewAttempt.updateMany({
        where: { id: previews.attemptId!, status: 'PUBLISHED' }, data: { status: 'PENDING' },
      });
    }
      return completed;
    }, { maxWait: 250, timeout: remaining - 250 });
  } catch {
    // 可选发布事务超时/回滚后仍尝试完成基础媒体；已提交的完成状态不会被覆盖。
    return completeBase();
  }
}
