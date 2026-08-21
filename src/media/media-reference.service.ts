import { BadRequestException, Injectable } from '@nestjs/common';
import { MediaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { extractMarkdownImageUrls } from '../common/markdown-cover-images';

type DbClient = PrismaService | Prisma.TransactionClient;

const RECONCILE_BATCH_SIZE = 500;

/**
 * 规范化媒体引用，并维护 Media.orphanedAt。
 * Markdown 继续保存 URL；账本只记录能精确匹配站内 Media 的图片。
 */
@Injectable()
export class MediaReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async syncPostContent(tx: Prisma.TransactionClient, postId: string, content: string) {
    const mediaIds = await this.resolveCompletedMarkdownMedia(tx, content);
    const previous = await tx.postMedia.findMany({
      where: { postId },
      select: { mediaId: true },
    });

    await tx.postMedia.deleteMany({ where: { postId } });
    if (mediaIds.length > 0) {
      await tx.postMedia.createMany({
        data: mediaIds.map((mediaId, sortOrder) => ({ postId, mediaId, sortOrder })),
      });
    }
    await this.reconcileMediaIds(tx, [...previous.map((item) => item.mediaId), ...mediaIds]);
  }

  async syncDraftContent(tx: Prisma.TransactionClient, draftId: string, content: string) {
    const mediaIds = await this.resolveCompletedMarkdownMedia(tx, content);
    const previous = await tx.draftMedia.findMany({
      where: { draftId },
      select: { mediaId: true },
    });

    await tx.draftMedia.deleteMany({ where: { draftId } });
    if (mediaIds.length > 0) {
      await tx.draftMedia.createMany({
        data: mediaIds.map((mediaId, sortOrder) => ({ draftId, mediaId, sortOrder })),
      });
    }
    await this.reconcileMediaIds(tx, [...previous.map((item) => item.mediaId), ...mediaIds]);
  }

  async releasePostContent(tx: Prisma.TransactionClient, postId: string) {
    const previous = await tx.postMedia.findMany({
      where: { postId },
      select: { mediaId: true },
    });
    await tx.postMedia.deleteMany({ where: { postId } });
    await this.reconcileMediaIds(
      tx,
      previous.map((item) => item.mediaId),
    );
  }

  async releaseThreadContent(tx: Prisma.TransactionClient, threadId: string) {
    const previous = await tx.postMedia.findMany({
      where: { post: { threadId } },
      select: { mediaId: true },
    });
    await tx.postMedia.deleteMany({ where: { post: { threadId } } });
    await this.reconcileMediaIds(
      tx,
      previous.map((item) => item.mediaId),
    );
  }

  async releaseSubthreadContent(tx: Prisma.TransactionClient, subthreadId: string) {
    const previous = await tx.postMedia.findMany({
      where: { post: { subthreadId } },
      select: { mediaId: true },
    });
    await tx.postMedia.deleteMany({ where: { post: { subthreadId } } });
    await this.reconcileMediaIds(
      tx,
      previous.map((item) => item.mediaId),
    );
  }

  async releaseDraftContent(tx: Prisma.TransactionClient, draftId: string) {
    const previous = await tx.draftMedia.findMany({
      where: { draftId },
      select: { mediaId: true },
    });
    await tx.draftMedia.deleteMany({ where: { draftId } });
    await this.reconcileMediaIds(
      tx,
      previous.map((item) => item.mediaId),
    );
  }

  /** 在关联写入或解除后调用；数据库中的真实关系始终覆盖调用方假设。 */
  async reconcileMediaIds(tx: DbClient, mediaIds: string[]) {
    const uniqueIds = [...new Set(mediaIds)].filter(Boolean);
    if (uniqueIds.length === 0) return;

    const referenced = await tx.media.findMany({
      where: {
        id: { in: uniqueIds },
        OR: this.referenceWhere(),
      },
      select: { id: true },
    });
    const referencedIds = referenced.map((item) => item.id);
    const referencedSet = new Set(referencedIds);
    const orphanedIds = uniqueIds.filter((id) => !referencedSet.has(id));

    if (referencedIds.length > 0) {
      await tx.media.updateMany({
        where: { id: { in: referencedIds } },
        data: { orphanedAt: null },
      });
    }
    if (orphanedIds.length > 0) {
      await tx.media.updateMany({
        where: { id: { in: orphanedIds }, status: MediaStatus.COMPLETED },
        data: { orphanedAt: new Date() },
      });
    }
  }

  /** 每日任务的自愈对账，修复级联删除或历史代码遗漏造成的标记漂移。 */
  async reconcileAllMarkers() {
    let changed = 0;
    for (;;) {
      const falselyOrphaned = await this.prisma.media.findMany({
        where: {
          status: MediaStatus.COMPLETED,
          orphanedAt: { not: null },
          OR: this.referenceWhere(),
        },
        select: { id: true },
        take: RECONCILE_BATCH_SIZE,
      });
      if (falselyOrphaned.length === 0) break;
      const result = await this.prisma.media.updateMany({
        where: { id: { in: falselyOrphaned.map((item) => item.id) } },
        data: { orphanedAt: null },
      });
      changed += result.count;
    }

    for (;;) {
      const missingMarker = await this.prisma.media.findMany({
        where: {
          status: MediaStatus.COMPLETED,
          orphanedAt: null,
          NOT: { OR: this.referenceWhere() },
        },
        select: { id: true },
        take: RECONCILE_BATCH_SIZE,
      });
      if (missingMarker.length === 0) break;
      const result = await this.prisma.media.updateMany({
        where: { id: { in: missingMarker.map((item) => item.id) }, orphanedAt: null },
        data: { orphanedAt: new Date() },
      });
      changed += result.count;
    }
    return changed;
  }

  /** 删除对象前的最终权威校验。 */
  async filterUnreferenced(mediaIds: string[]) {
    if (mediaIds.length === 0) return [];
    const referenced = await this.prisma.media.findMany({
      where: { id: { in: mediaIds }, OR: this.referenceWhere() },
      select: { id: true },
    });
    const referencedIds = new Set(referenced.map((item) => item.id));
    return mediaIds.filter((id) => !referencedIds.has(id));
  }

  private async resolveCompletedMarkdownMedia(tx: DbClient, content: string) {
    const urls = extractMarkdownImageUrls(content);
    if (urls.length === 0) return [];

    const rows = await tx.media.findMany({
      where: { url: { in: urls } },
      select: { id: true, url: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    const byUrl = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!byUrl.has(row.url)) byUrl.set(row.url, row);
    }

    const resolved: string[] = [];
    for (const url of urls) {
      const media = byUrl.get(url);
      if (!media) continue;
      if (media.status !== MediaStatus.COMPLETED) {
        throw new BadRequestException(`正文图片尚未处理完成（mediaId: ${media.id}）`);
      }
      resolved.push(media.id);
    }
    return resolved;
  }

  private referenceWhere(): Prisma.MediaWhereInput[] {
    return [
      { avatarUser: { isNot: null } },
      { profileCoverUser: { isNot: null } },
      { profileCoverMobileUser: { isNot: null } },
      { directMessage: { isNot: null } },
      { momentImages: { some: {} } },
      { momentCovers: { some: {} } },
      { momentComment: { isNot: null } },
      { postAttachments: { some: {} } },
      { draftAttachments: { some: {} } },
      { stickerImports: { some: { status: 'PROCESSING' } } },
    ];
  }
}
