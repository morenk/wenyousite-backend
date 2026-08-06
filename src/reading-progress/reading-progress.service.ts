import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { notFound } from '../common/exceptions/business.exception';

/** 阅读进度服务：记录和查询用户在每个子贴中的最后阅读位置（精确到楼层/楼中楼） */
@Injectable()
export class ReadingProgressService {
  constructor(
    private prisma: PrismaService,
    private threadAccess: ThreadAccessService,
  ) {}

  private async assertSubthreadAccessible(subthreadId: string, userId: string) {
    const subthread = await this.prisma.subthread.findUnique({
      where: { id: subthreadId, deletedAt: null },
      select: { threadId: true },
    });
    if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');
    await this.threadAccess.assertAccessible(subthread.threadId, userId);
    return subthread;
  }

  /** 查询用户在指定子贴的阅读进度 */
  async findBySubthread(userId: string, subthreadId: string) {
    await this.assertSubthreadAccessible(subthreadId, userId);
    return this.prisma.userReadProgress.findUnique({
      where: { userId_subthreadId: { userId, subthreadId } },
      include: {
        post: {
          select: { id: true, floorNumber: true, content: true },
        },
      },
    });
  }

  /** 查询用户在所有子贴的阅读进度，排除已软删除的子贴 */
  async findAll(userId: string) {
    return this.prisma.userReadProgress.findMany({
      where: {
        userId,
        subthread: {
          deletedAt: null,
          thread: {
            deletedAt: null,
            OR: [
              { published: false, ownerId: userId },
              { published: true, visibility: 'PUBLIC' },
              { published: true, members: { some: { userId } } },
            ],
          },
        },
      },
      include: {
        subthread: { select: { id: true, title: true, threadId: true } },
        post: { select: { id: true, floorNumber: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 更新/创建阅读进度（upsert） */
  async update(userId: string, subthreadId: string, postId?: string) {
    await this.assertSubthreadAccessible(subthreadId, userId);
    if (postId) {
      const post = await this.prisma.post.findFirst({
        where: { id: postId, subthreadId, deletedAt: null },
        select: { id: true },
      });
      if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '阅读位置不存在');
    }
    return this.prisma.userReadProgress.upsert({
      where: { userId_subthreadId: { userId, subthreadId } },
      create: { userId, subthreadId, postId },
      update: { postId, updatedAt: new Date() },
    });
  }

  /** 查询自上次阅读位置后的新增回复数。锚点用 lastReadPost.createdAt，不受进度更新时间影响 */
  async newRepliesSince(userId: string, subthreadId: string) {
    await this.assertSubthreadAccessible(subthreadId, userId);
    const progress = await this.prisma.userReadProgress.findUnique({
      where: { userId_subthreadId: { userId, subthreadId } },
      include: { post: { select: { id: true, createdAt: true, floorNumber: true, parentPostId: true } } },
    });

    const totalPosts = await this.prisma.post.count({
      where: { subthreadId, deletedAt: null },
    });

    if (!progress) {
      return {
        subthreadId,
        newReplies: totalPosts,
        totalPosts,
        lastReadPostId: null,
        lastReadTime: null,
        continueFrom: null,
      };
    }

    // 锚点：优先用上次读到的那条帖子的 createdAt，首次进入无 postId 时用 updatedAt
    const anchor = progress.post?.createdAt ?? progress.updatedAt;

    const newPosts = await this.prisma.post.count({
      where: {
        subthreadId,
        deletedAt: null,
        createdAt: { gt: anchor },
      },
    });

    return {
      subthreadId,
      newReplies: newPosts,
      totalPosts,
      lastReadPostId: progress.postId,
      lastReadTime: progress.updatedAt,
      continueFrom: progress.post
        ? { id: progress.post.id, floorNumber: progress.post.floorNumber, parentPostId: progress.post.parentPostId }
        : null,
    };
  }

  /** 批量查询主题帖下全部子贴的新回复，避免详情页按子贴发起 N 次 HTTP 请求。 */
  async newRepliesForThread(userId: string, threadId: string) {
    await this.threadAccess.assertAccessible(threadId, userId);

    const subthreads = await this.prisma.subthread.findMany({
      where: { threadId, deletedAt: null },
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (subthreads.length === 0) return { items: [] };

    const subthreadIds = subthreads.map((subthread) => subthread.id);
    const [progresses, totalRows] = await Promise.all([
      this.prisma.userReadProgress.findMany({
        where: { userId, subthreadId: { in: subthreadIds } },
        select: {
          subthreadId: true,
          postId: true,
          updatedAt: true,
          post: {
            select: {
              id: true,
              createdAt: true,
              floorNumber: true,
              parentPostId: true,
            },
          },
        },
      }),
      this.prisma.post.groupBy({
        by: ['subthreadId'],
        where: { subthreadId: { in: subthreadIds }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const progressBySubthread = new Map(
      progresses.map((progress) => [progress.subthreadId, progress]),
    );
    const totalBySubthread = new Map(
      totalRows.map((row) => [row.subthreadId, row._count._all]),
    );

    const newRows = await this.prisma.post.groupBy({
      by: ['subthreadId'],
      where: {
        deletedAt: null,
        OR: subthreads.map(({ id }) => {
          const progress = progressBySubthread.get(id);
          const anchor = progress?.post?.createdAt ?? progress?.updatedAt;
          return {
            subthreadId: id,
            ...(anchor ? { createdAt: { gt: anchor } } : {}),
          };
        }),
      },
      _count: { _all: true },
    });
    const newBySubthread = new Map(
      newRows.map((row) => [row.subthreadId, row._count._all]),
    );

    return {
      items: subthreads.map(({ id }) => {
        const progress = progressBySubthread.get(id);
        return {
          subthreadId: id,
          newReplies: newBySubthread.get(id) ?? 0,
          totalPosts: totalBySubthread.get(id) ?? 0,
          lastReadPostId: progress?.postId ?? null,
          lastReadTime: progress?.updatedAt ?? null,
          continueFrom: progress?.post
            ? {
                id: progress.post.id,
                floorNumber: progress.post.floorNumber,
                parentPostId: progress.post.parentPostId,
              }
            : null,
        };
      }),
    };
  }
}
