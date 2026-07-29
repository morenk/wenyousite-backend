import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 阅读进度服务：记录和查询用户在每个子贴中的最后阅读位置（精确到楼层/楼中楼） */
@Injectable()
export class ReadingProgressService {
  constructor(private prisma: PrismaService) {}

  /** 查询用户在指定子贴的阅读进度 */
  async findBySubthread(userId: string, subthreadId: string) {
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
      where: { userId, subthread: { deletedAt: null } },
      include: {
        subthread: { select: { id: true, title: true, threadId: true } },
        post: { select: { id: true, floorNumber: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 更新/创建阅读进度（upsert） */
  async update(userId: string, subthreadId: string, postId?: string) {
    return this.prisma.userReadProgress.upsert({
      where: { userId_subthreadId: { userId, subthreadId } },
      create: { userId, subthreadId, postId },
      update: { postId, updatedAt: new Date() },
    });
  }

  /** 查询自上次阅读位置后的新增回复数。锚点用 lastReadPost.createdAt，不受进度更新时间影响 */
  async newRepliesSince(userId: string, subthreadId: string) {
    const progress = await this.prisma.userReadProgress.findUnique({
      where: { userId_subthreadId: { userId, subthreadId } },
      include: { post: { select: { id: true, createdAt: true, floorNumber: true, parentPostId: true } } },
    });

    const totalPosts = await this.prisma.post.count({
      where: { subthreadId, deletedAt: null },
    });

    if (!progress) {
      return { newReplies: totalPosts, totalPosts, lastReadPostId: null, lastReadTime: null, continueFrom: null };
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
      newReplies: newPosts,
      totalPosts,
      lastReadPostId: progress.postId,
      lastReadTime: progress.updatedAt,
      continueFrom: progress.post
        ? { id: progress.post.id, floorNumber: progress.post.floorNumber, parentPostId: progress.post.parentPostId }
        : null,
    };
  }

  /** 查询用户在某主题帖下所有子贴的阅读进度摘要 */
  async threadAggregation(userId: string, threadId: string) {
    const subthreads = await this.prisma.subthread.findMany({
      where: { threadId, deletedAt: null },
      select: { id: true, title: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (subthreads.length === 0) return [];

    const results = await Promise.all(
      subthreads.map(async (st) => {
        const progress = await this.prisma.userReadProgress.findUnique({
          where: { userId_subthreadId: { userId, subthreadId: st.id } },
          include: { post: { select: { id: true, createdAt: true, floorNumber: true, parentPostId: true } } },
        });

        const totalPosts = await this.prisma.post.count({
          where: { subthreadId: st.id, deletedAt: null },
        });

        const anchor = progress?.post?.createdAt ?? progress?.updatedAt;
        const newPosts = anchor
          ? await this.prisma.post.count({
              where: { subthreadId: st.id, deletedAt: null, createdAt: { gt: anchor } },
            })
          : totalPosts;

        return {
          subthreadId: st.id,
          subthreadTitle: st.title,
          sortOrder: st.sortOrder,
          newReplies: newPosts,
          totalPosts,
          lastReadPostId: progress?.postId ?? null,
          lastReadTime: progress?.updatedAt ?? null,
          continueFrom: progress?.post
            ? { id: progress.post.id, floorNumber: progress.post.floorNumber, parentPostId: progress.post.parentPostId }
            : null,
        };
      }),
    );

    return results;
  }
}
