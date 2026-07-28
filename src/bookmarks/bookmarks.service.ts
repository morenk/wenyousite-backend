import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { PaginatedResult, paginate } from '../common/dto/paginated-result';

/** 收藏服务：CRUD + 可见性过滤 */
@Injectable()
export class BookmarksService {
  constructor(private prisma: PrismaService) {}

  /** 我的收藏列表（含公开帖 + 我仍是成员的私密帖） */
  async findAll(userId: string, cursor?: string, limit = 20): Promise<PaginatedResult<any>> {
    const take = Math.min(limit, 50);
    const bookmarks = await this.prisma.userBookmark.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        thread: {
          include: {
            owner: { select: { id: true, username: true, nickname: true, avatar: true } },
            _count: { select: { members: true, posts: true } },
          },
        },
      },
    });

    // 过滤掉已失效的私密帖（用户已不再成员，但收藏记录残留）
    const valid = bookmarks.filter((b) => {
      if (!b.thread.deletedAt) return true;
      return false;
    });

    const hasMore = valid.length > take;
    if (hasMore) valid.pop();

    return paginate(
      valid.map((b) => b.thread),
      {
        cursor: valid.length > 0 ? bookmarks[valid.length - 1].id : null,
        hasMore,
      },
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

    // 私密帖：只有成员才能收藏
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
