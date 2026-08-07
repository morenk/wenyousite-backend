import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { PaginatedResult, paginate } from '../common/dto/paginated-result';
import { publicUserSummarySelect } from '../common/user-summary';

const bookmarkThreadInclude = {
  owner: { select: publicUserSummarySelect },
  _count: { select: { members: true, posts: true } },
} satisfies Prisma.ThreadInclude;

type BookmarkThread = Prisma.ThreadGetPayload<{ include: typeof bookmarkThreadInclude }>;
type OwnBookmarkThread = BookmarkThread & { bookmarkId: string };

/** 收藏服务：CRUD + 可见性过滤 */
@Injectable()
export class BookmarksService {
  constructor(private prisma: PrismaService) {}

  /** 我的收藏列表（含公开帖 + 我仍是参与人的私密帖） */
  async findAll(
    userId: string,
    cursor?: string,
    limit = 20,
  ): Promise<PaginatedResult<OwnBookmarkThread>> {
    const take = Math.min(limit, 50);
    const bookmarks = await this.prisma.userBookmark.findMany({
      where: { userId, thread: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        thread: {
          include: bookmarkThreadInclude,
        },
      },
    });

    const hasMore = bookmarks.length > take;
    if (hasMore) bookmarks.pop();

    return paginate(
      bookmarks.map((b) => ({ ...b.thread, bookmarkId: b.id })),
      {
        cursor: bookmarks.at(-1)?.id ?? null,
        hasMore,
      },
    );
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
    if (!targetUser) throw new NotFoundException('用户不存在');
    if (!targetUser.showBookmarks && targetId !== viewerId) {
      throw new NotFoundException('该用户未公开收藏');
    }

    const take = Math.min(limit, 50);
    const isSelf = targetId === viewerId;
    const visibilityWhere = isSelf
      ? {}
      : viewerId
        ? {
            OR: [
              { visibility: 'PUBLIC' as const },
              {
                visibility: 'PRIVATE' as const,
                members: { some: { userId: viewerId } },
              },
            ],
          }
        : { visibility: 'PUBLIC' as const };
    const bookmarks = await this.prisma.userBookmark.findMany({
      where: {
        userId: targetId,
        thread: {
          deletedAt: null,
          published: true,
          ...visibilityWhere,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        thread: {
          include: bookmarkThreadInclude,
        },
      },
    });

    const hasMore = bookmarks.length > take;
    if (hasMore) bookmarks.pop();

    return paginate(
      bookmarks.map(b => b.thread),
      { cursor: bookmarks.at(-1)?.id ?? null, hasMore },
    );
  }

  /** 收藏主题帖 */
  async create(userId: string, threadId: string) {
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

    const existing = await this.prisma.userBookmark.findUnique({
      where: { userId_threadId: { userId, threadId } },
    });
    if (existing) {
      throw new BusinessException(ErrorCode.CONFLICT, '已收藏该主题帖', 409);
    }

    return this.prisma.userBookmark.create({
      data: { userId, threadId },
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
}
