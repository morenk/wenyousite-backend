import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_BOOKMARK_FOLDER_NAME } from '../bookmarks/bookmark-folder.constants';
import { paginate } from '../common/dto/paginated-result';
import { PrismaService } from '../prisma/prisma.service';
import { mapMomentCard, type MomentCardRow } from './moment.mapper';
import { momentCardSelect, momentViewerVisibility } from './moment-query';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { MomentAccessService } from './moment-access.service';

const MAX_PAGE_SIZE = 50;

type Viewer = { id: string; role?: string };

@Injectable()
export class MomentBookmarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: MomentAccessService,
  ) {}

  async listFolders(userId: string) {
    await this.ensureDefaultFolder(this.prisma, userId);
    const folders = await this.prisma.momentBookmarkFolder.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { bookmarks: true } } },
    });
    return folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      isDefault: folder.isDefault,
      createdAt: folder.createdAt,
      momentBookmarkCount: folder._count.bookmarks,
    }));
  }

  async createFolder(userId: string, rawName: string) {
    const name = rawName.trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '动态收藏夹名称不能为空');
    }
    await this.ensureDefaultFolder(this.prisma, userId);
    try {
      const folder = await this.prisma.momentBookmarkFolder.create({
        data: { userId, name },
      });
      return {
        id: folder.id,
        name: folder.name,
        isDefault: folder.isDefault,
        createdAt: folder.createdAt,
        momentBookmarkCount: 0,
      };
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BusinessException(ErrorCode.CONFLICT, '已存在同名动态收藏夹', 409);
      }
      throw error;
    }
  }

  async set(momentId: string, viewer: Viewer, active: boolean, folderId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const moment = await this.access.lockVisible(tx, momentId, viewer.id);
      if (active) {
        const existing = await tx.momentBookmark.findUnique({
          where: { momentId_userId: { momentId, userId: viewer.id } },
          select: { id: true, folderId: true },
        });
        if (existing) {
          if (folderId && folderId !== existing.folderId) {
            this.access.assertCanAddInteraction(moment);
            const target = await this.resolveFolder(viewer.id, folderId, tx);
            await tx.momentBookmark.update({
              where: { id: existing.id },
              data: { folderId: target.id },
            });
          }
        } else {
          this.access.assertCanAddInteraction(moment);
          const target = await this.resolveFolder(viewer.id, folderId, tx);
          const created = await tx.momentBookmark.createMany({
            data: [{ momentId, userId: viewer.id, folderId: target.id }],
            skipDuplicates: true,
          });
          if (created.count > 0) {
            const updated = await tx.moment.updateMany({
              where: { id: momentId, deletedAt: null },
              data: { bookmarkCount: { increment: 1 } },
            });
            if (updated.count === 0) {
              throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态不存在');
            }
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
          const updated = await tx.moment.updateMany({
            where: { id: momentId, deletedAt: null },
            data: { bookmarkCount: { decrement: 1 } },
          });
          if (updated.count === 0) {
            throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态不存在');
          }
        }
      }
      const current = await tx.moment.findUniqueOrThrow({
        where: { id: momentId },
        select: { bookmarkCount: true },
      });
      return { momentId, count: current.bookmarkCount, active };
    });
  }

  async move(momentId: string, userId: string, folderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const moment = await this.access.lockVisible(tx, momentId, userId);
      this.access.assertCanAddInteraction(moment);
      const target = await this.resolveFolder(userId, folderId, tx);
      const updated = await tx.momentBookmark.updateMany({
        where: { momentId, userId },
        data: { folderId: target.id },
      });
      if (updated.count === 0) throw notFound(ErrorCode.NOT_FOUND, '收藏不存在');
      return { momentId, folderId: target.id };
    });
  }

  async listMine(cursor: string | undefined, limit = 20, viewer: Viewer, folderId?: string) {
    const resolvedFolderId = folderId
      ? (await this.resolveFolder(viewer.id, folderId)).id
      : undefined;
    return this.list({
      ownerId: viewer.id,
      viewerId: viewer.id,
      cursor,
      limit,
      folderId: resolvedFolderId,
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
      throw notFound(ErrorCode.NOT_FOUND, '该用户未公开收藏');
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
      if (!valid) {
        throw new BusinessException(
          ErrorCode.INVALID_CURSOR,
          '无效的收藏分页游标',
          HttpStatus.BAD_REQUEST,
        );
      }
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

  private resolveFolder(
    userId: string,
    folderId?: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return folderId
      ? this.requireOwnedFolder(userId, folderId, client)
      : this.ensureDefaultFolder(client, userId);
  }

  private ensureDefaultFolder(client: Prisma.TransactionClient | PrismaService, userId: string) {
    return client.momentBookmarkFolder.upsert({
      where: {
        userId_name: { userId, name: DEFAULT_BOOKMARK_FOLDER_NAME },
      },
      update: {},
      create: {
        userId,
        name: DEFAULT_BOOKMARK_FOLDER_NAME,
        isDefault: true,
      },
    });
  }

  private async requireOwnedFolder(
    userId: string,
    folderId: string,
    client: Prisma.TransactionClient | PrismaService,
  ) {
    const folder = await client.momentBookmarkFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (folder) return folder;

    // Compatibility window for clients that still load the former shared
    // catalog: resolve the thread-folder ID to an independent same-name
    // dynamic folder, lazily copying it only when necessary.
    const legacyFolder = await client.bookmarkFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (!legacyFolder) throw notFound(ErrorCode.NOT_FOUND, '动态收藏夹不存在');

    const existing = await client.momentBookmarkFolder.findUnique({
      where: { userId_name: { userId, name: legacyFolder.name } },
    });
    if (existing) return existing;

    try {
      return await client.momentBookmarkFolder.create({
        data: {
          id: legacyFolder.id,
          userId,
          name: legacyFolder.name,
          isDefault: legacyFolder.isDefault,
        },
      });
    } catch (error: unknown) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const concurrent = await client.momentBookmarkFolder.findUnique({
        where: { userId_name: { userId, name: legacyFolder.name } },
      });
      if (concurrent) return concurrent;
      throw error;
    }
  }
}
