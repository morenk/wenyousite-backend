import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { PaginatedResult, paginate } from '../common/dto/paginated-result';
import { publishedThreadVisibilityWhere } from '../access/thread-visibility.where';
import { attachPlayerCounts } from '../common/prisma-helpers';
import { mapThreadListCard, threadListCardInclude } from '../threads/thread-list-card';

type BookmarkThread = ReturnType<typeof mapThreadListCard>;
type OwnBookmarkThread = BookmarkThread & { bookmarkId: string; bookmarkFolderId: string };

export const DEFAULT_BOOKMARK_FOLDER_NAME = '默认收藏夹';

/** 收藏服务：CRUD + 可见性过滤 */
@Injectable()
export class BookmarksService {
  constructor(private prisma: PrismaService) {}

  /** 我的收藏列表（含公开帖 + 我仍是参与人的私密帖） */
  async findAll(
    userId: string,
    cursor?: string,
    limit = 20,
    folderId?: string,
  ): Promise<PaginatedResult<OwnBookmarkThread>> {
    if (folderId) await this.resolveFolder(userId, folderId);
    const take = Math.min(limit, 50);
    const bookmarks = await this.prisma.userBookmark.findMany({
      where: {
        userId,
        ...(folderId ? { folderId } : {}),
        thread: publishedThreadVisibilityWhere(userId),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        thread: {
          include: threadListCardInclude,
        },
      },
    });

    const hasMore = bookmarks.length > take;
    if (hasMore) bookmarks.pop();
    await attachPlayerCounts(
      this.prisma,
      bookmarks.map((bookmark) => bookmark.thread),
    );

    return paginate(
      bookmarks.map((b) => ({
        ...mapThreadListCard(b.thread),
        bookmarkId: b.id,
        bookmarkFolderId: b.folderId,
      })),
      {
        cursor: bookmarks.at(-1)?.id ?? null,
        hasMore,
      },
    );
  }

  /** 当前用户的收藏夹；默认收藏夹始终位于首位。 */
  async findFolders(userId: string) {
    await this.ensureDefaultFolder(this.prisma, userId);
    const folders = await this.prisma.bookmarkFolder.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { bookmarks: true, momentBookmarks: true } } },
    });
    return folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      isDefault: folder.isDefault,
      createdAt: folder.createdAt,
      bookmarkCount: folder._count.bookmarks,
      momentBookmarkCount: folder._count.momentBookmarks,
    }));
  }

  /** 新建自定义收藏夹。 */
  async createFolder(userId: string, rawName: string) {
    const name = rawName.trim();
    if (!name) throw new BusinessException(ErrorCode.BAD_REQUEST, '收藏夹名称不能为空');
    await this.ensureDefaultFolder(this.prisma, userId);
    try {
      const folder = await this.prisma.bookmarkFolder.create({
        data: { userId, name },
      });
      return {
        id: folder.id,
        name: folder.name,
        isDefault: folder.isDefault,
        createdAt: folder.createdAt,
        bookmarkCount: 0,
        momentBookmarkCount: 0,
      };
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BusinessException(ErrorCode.CONFLICT, '已存在同名收藏夹', 409);
      }
      throw error;
    }
  }

  /** 查看指定用户的公开收藏（受 showBookmarks 隐私开关控制） */
  async findByUserId(
    targetId: string,
    viewerId?: string,
    cursor?: string,
    limit = 20,
  ): Promise<PaginatedResult<BookmarkThread>> {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetId, deletedAt: null },
      select: { id: true, showBookmarks: true, deletedAt: true },
    });
    if (!targetUser) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    if (!targetUser.showBookmarks && targetId !== viewerId) {
      throw new NotFoundException('该用户未公开收藏');
    }

    const take = Math.min(limit, 50);
    const bookmarks = await this.prisma.userBookmark.findMany({
      where: {
        userId: targetId,
        thread: publishedThreadVisibilityWhere(viewerId),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        thread: {
          include: threadListCardInclude,
        },
      },
    });

    const hasMore = bookmarks.length > take;
    if (hasMore) bookmarks.pop();
    await attachPlayerCounts(
      this.prisma,
      bookmarks.map((bookmark) => bookmark.thread),
    );

    return paginate(
      bookmarks.map((b) => mapThreadListCard(b.thread)),
      { cursor: bookmarks.at(-1)?.id ?? null, hasMore },
    );
  }

  /** 收藏主题帖 */
  async create(userId: string, threadId: string, folderId?: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: { id: true, visibility: true, published: true },
    });
    if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    if (!thread.published) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');

    // 私密帖：只有参与人才能收藏
    if (thread.visibility === 'PRIVATE') {
      const member = await this.prisma.threadMember.findUnique({
        where: { threadId_userId: { threadId, userId } },
      });
      if (!member) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const targetFolder = await this.resolveFolder(userId, folderId, tx);
        const existing = await tx.userBookmark.findUnique({
          where: { userId_threadId: { userId, threadId } },
        });
        if (existing) {
          throw new BusinessException(ErrorCode.CONFLICT, '已收藏该主题帖', 409);
        }
        return tx.userBookmark.create({
          data: { userId, threadId, folderId: targetFolder.id },
        });
      });
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BusinessException(ErrorCode.CONFLICT, '已收藏该主题帖', 409);
      }
      throw error;
    }
  }

  /** 调整一条收藏的所属收藏夹。 */
  async move(id: string, userId: string, folderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const bookmark = await tx.userBookmark.findFirst({ where: { id, userId } });
      if (!bookmark) throw notFound(ErrorCode.NOT_FOUND, '收藏不存在');
      await this.resolveFolder(userId, folderId, tx);
      return tx.userBookmark.update({ where: { id }, data: { folderId } });
    });
  }

  /** 取消收藏 */
  async remove(id: string, userId: string) {
    const bookmark = await this.prisma.userBookmark.findUnique({ where: { id } });
    if (!bookmark || bookmark.userId !== userId) {
      throw notFound(ErrorCode.NOT_FOUND, '收藏不存在');
    }
    return this.prisma.userBookmark.delete({ where: { id } });
  }

  /** 解析用户自己的目标收藏夹；未指定时返回或补建默认收藏夹。 */
  resolveFolder(
    userId: string,
    folderId?: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return folderId
      ? this.requireOwnedFolder(userId, folderId, client)
      : this.ensureDefaultFolder(client, userId);
  }

  private ensureDefaultFolder(client: Prisma.TransactionClient | PrismaService, userId: string) {
    return client.bookmarkFolder.upsert({
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
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const folder = await client.bookmarkFolder.findFirst({
      where: { id: folderId, userId },
    });
    if (!folder) throw notFound(ErrorCode.NOT_FOUND, '收藏夹不存在');
    return folder;
  }
}
