import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { attachPlayerCounts } from '../common/prisma-helpers';

/**
 * 全站搜索服务：基于 PostgreSQL ILIKE 搜索用户名、主题帖和楼层。
 */
@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(q: string) {
    if (!q || q.trim().length === 0) return { users: [], threads: [], posts: [] };

    const keyword = q.trim();

    const [users, threads, posts] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          username: { contains: keyword, mode: 'insensitive' },
        },
        select: { id: true, username: true, avatar: true, bio: true },
        take: 20,
        orderBy: { username: 'asc' },
      }),
      this.prisma.thread.findMany({
        where: {
          deletedAt: null,
          published: true,
          visibility: 'PUBLIC',
          OR: [
            { title: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true, title: true, category: true, createdAt: true,
          owner: { select: { id: true, username: true, avatar: true } },
          _count: { select: { members: true, posts: true } },
        },
        take: 50,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.post.findMany({
        where: {
          deletedAt: null,
          content: { contains: keyword, mode: 'insensitive' },
          thread: { published: true, visibility: 'PUBLIC', deletedAt: null },
        },
        select: {
          id: true, floorNumber: true, content: true, createdAt: true,
          author: { select: { id: true, username: true } },
          thread: { select: { id: true, title: true } },
          subthread: { select: { id: true, title: true } },
        },
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    await attachPlayerCounts(this.prisma, threads);

    return { users, threads, posts };
  }
}
