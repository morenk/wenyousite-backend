import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BookmarksService } from '../bookmarks/bookmarks.service';
import { paginate } from '../common/dto/paginated-result';
import { PrismaService } from '../prisma/prisma.service';
import { mapMomentCard, type MomentCardRow } from './moment.mapper';
import { momentCardSelect, momentViewerVisibility } from './moment-query';
import { MomentsService } from './moments.service';
import { notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

const MAX_PAGE_SIZE = 30;

type Viewer = { id: string; role?: string };

@Injectable()
export class MomentBookmarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folders: BookmarksService,
    private readonly moments: MomentsService,
  ) {}

  async set(momentId: string, viewer: Viewer, active: boolean, folderId?: string) {
    await this.moments.assertVisible(momentId, viewer.id);
    return this.prisma.$transaction(async (tx) => {
      if (active) {
        const existing = await tx.momentBookmark.findUnique({
          where: { momentId_userId: { momentId, userId: viewer.id } },
          select: { id: true, folderId: true },
        });
        if (existing) {
          if (folderId && folderId !== existing.folderId) {
            const target = await this.folders.resolveFolder(viewer.id, folderId, tx);
            await tx.momentBookmark.update({
              where: { id: existing.id },
              data: { folderId: target.id },
            });
          }
        } else {
          const target = await this.folders.resolveFolder(viewer.id, folderId, tx);
          const created = await tx.momentBookmark.createMany({
            data: [{ momentId, userId: viewer.id, folderId: target.id }],
            skipDuplicates: true,
          });
          if (created.count > 0) {
            await tx.moment.update({
              where: { id: momentId },
              data: { bookmarkCount: { increment: 1 } },
            });
          } else if (folderId) {
            await tx.momentBookmark.updateMany({
              where: { momentId, userId: viewer.id },
              data: { folderId: target.id },
            });
          }
        }
      } else {
        const removed = await tx.momentBookmark.deleteMany({
          where: { momentId, userId: viewer.id },
        });
        if (removed.count > 0) {
          await tx.moment.update({
            where: { id: momentId },
            data: { bookmarkCount: { decrement: 1 } },
          });
        }
      }
      const moment = await tx.moment.findUniqueOrThrow({
        where: { id: momentId },
        select: { bookmarkCount: true },
      });
      return { momentId, count: moment.bookmarkCount, active };
    });
  }

  async move(momentId: string, userId: string, folderId: string) {
    await this.moments.assertVisible(momentId, userId);
    return this.prisma.$transaction(async (tx) => {
      const target = await this.folders.resolveFolder(userId, folderId, tx);
      const updated = await tx.momentBookmark.updateMany({
        where: { momentId, userId },
        data: { folderId: target.id },
      });
      if (updated.count === 0) throw new NotFoundException('收藏不存在');
      return { momentId, folderId: target.id };
    });
  }

  async listMine(cursor: string | undefined, limit = 20, viewer: Viewer, folderId?: string) {
    if (folderId) await this.folders.resolveFolder(viewer.id, folderId);
    return this.list({
      ownerId: viewer.id,
      viewerId: viewer.id,
      cursor,
      limit,
      folderId,
      includePlacement: true,
    });
  }

  async listPublic(ownerId: string, viewerId?: string, cursor?: string, limit = 20) {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId, deletedAt: null },
      select: { id: true, showBookmarks: true },
    });
    if (!owner) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    if (!owner.showBookmarks && ownerId !== viewerId) {
      throw new NotFoundException('该用户未公开收藏');
    }
    return this.list({ ownerId, viewerId, cursor, limit, includePlacement: false });
  }

  private async list(input: {
    ownerId: string;
    viewerId?: string;
    cursor?: string;
    limit: number;
    folderId?: string;
    includePlacement: boolean;
  }) {
    const take = Math.min(input.limit, MAX_PAGE_SIZE);
    if (input.cursor) {
      const valid = await this.prisma.momentBookmark.findFirst({
        where: { id: input.cursor, userId: input.ownerId },
        select: { id: true },
      });
      if (!valid) throw new BadRequestException('无效的收藏分页游标');
    }
    const bookmarks = await this.prisma.momentBookmark.findMany({
      where: {
        userId: input.ownerId,
        ...(input.folderId ? { folderId: input.folderId } : {}),
        moment: { deletedAt: null, ...momentViewerVisibility(input.viewerId) },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: input.cursor ? { id: input.cursor } : undefined,
      skip: input.cursor ? 1 : 0,
      take: take + 1,
      select: {
        id: true,
        folderId: true,
        moment: { select: momentCardSelect(input.viewerId) },
      },
    });
    const hasMore = bookmarks.length > take;
    const page = bookmarks.slice(0, take);
    return paginate(
      page.map((bookmark) => ({
        ...mapMomentCard(bookmark.moment as MomentCardRow),
        ...(input.includePlacement ? { bookmarkFolderId: bookmark.folderId } : {}),
      })),
      { cursor: page.at(-1)?.id ?? null, hasMore },
    );
  }
}
