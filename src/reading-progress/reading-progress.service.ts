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

  /** 查询用户在所有子贴的阅读进度 */
  async findAll(userId: string) {
    return this.prisma.userReadProgress.findMany({
      where: { userId },
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

  /** 查询自上次阅读后的新增回复数 */
  async newRepliesSince(userId: string, subthreadId: string) {
    const progress = await this.prisma.userReadProgress.findUnique({
      where: { userId_subthreadId: { userId, subthreadId } },
    });
    const lastReadTime = progress?.updatedAt;
    const lastPostId = progress?.postId;

    // 若从未读过，返回全部楼层数
    const totalPosts = await this.prisma.post.count({
      where: { subthreadId, deletedAt: null },
    });

    if (!lastReadTime) {
      return { newReplies: totalPosts, totalPosts, lastReadPostId: null, continueFrom: null };
    }

    // 统计上次阅读后新增的帖子
    const newPosts = await this.prisma.post.count({
      where: {
        subthreadId,
        deletedAt: null,
        createdAt: { gt: lastReadTime },
      },
    });

    return {
      newReplies: newPosts,
      totalPosts,
      lastReadPostId: lastPostId,
      lastReadTime,
      continueFrom: lastPostId
        ? await this.prisma.post.findUnique({
            where: { id: lastPostId, deletedAt: null },
            select: { id: true, floorNumber: true, parentPostId: true },
          })
        : null,
    };
  }
}
