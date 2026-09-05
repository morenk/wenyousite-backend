import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  SMART_SCORE_ZSET, SMART_SCORE_READY, newThreadSmartStats,
  addThreadContribution, computeThreadSmartScore,
} from './thread-smart-score';

/** 推荐只由数据库中的创作参与决定；Redis 是可整体恢复的派生排序。 */
@Injectable()
export class ThreadRankingService {
  // ponytail: 单 API 进程合并重建；多实例部署时改为共享重建租约。
  private rebuilding?: Promise<void>;
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async ensureReady() {
    try {
      const expectedSize = await this.redis.get(SMART_SCORE_READY);
      if (expectedSize === null || await this.redis.zcard(SMART_SCORE_ZSET) !== Number(expectedSize)) {
        await this.rebuild();
      }
    } catch {
      throw new ServiceUnavailableException('推荐列表正在恢复，请稍后重试');
    }
  }

  rebuild(): Promise<void> {
    this.rebuilding ??= this.rebuildFromDatabase().finally(() => { this.rebuilding = undefined; });
    return this.rebuilding;
  }

  private async rebuildFromDatabase() {
    const now = Date.now();
    const ranking: Array<{ id: string; score: number; publishedAt: number }> = [];
    let cursor: string | undefined;
    for (;;) {
      const threads = await this.prisma.thread.findMany({
        where: { published: true, deletedAt: null },
        orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, ownerId: true, publishedAt: true, createdAt: true, viewCount: true,
          likeCount: true, tipTotal: true,
          members: { where: { playerMarked: true }, select: { userId: true } },
        },
      });
      if (!threads.length) break;
      const states = new Map(threads.map((thread) => [thread.id, {
        thread, stats: newThreadSmartStats(), players: new Set(thread.members.map((member) => member.userId)),
      }]));
      let postCursor: string | undefined;
      for (;;) {
        const posts = await this.prisma.post.findMany({
          where: {
            threadId: { in: threads.map((thread) => thread.id) }, deletedAt: null,
            subthread: { deletedAt: null }, OR: [{ parentPostId: null }, { parentPost: { deletedAt: null } }],
          },
          orderBy: { id: 'asc' }, take: 500,
          ...(postCursor ? { cursor: { id: postCursor }, skip: 1 } : {}),
          select: { id: true, threadId: true, authorId: true, content: true, kind: true, createdAt: true },
        });
        for (const post of posts) {
          const state = states.get(post.threadId)!;
          addThreadContribution(state.stats, post, state.thread.ownerId, state.players, now);
        }
        if (posts.length < 500) break;
        postCursor = posts.at(-1)!.id;
      }
      const viewUpdates: Array<{ id: string; views: number }> = [];
      for (const { thread, stats } of states.values()) {
        const key = `thread:${thread.id}:stats`;
        const views = await this.redis.hincrbyAtLeast(key, 'views', thread.viewCount, 0);
        await Promise.all([
          this.redis.hset(key, 'replies', stats.replies), this.redis.hset(key, 'likes', thread.likeCount),
          this.redis.hset(key, 'tips', thread.tipTotal.toString()),
          this.redis.hset(key, 'createdAt', thread.createdAt.getTime()),
        ]);
        if (views > thread.viewCount) viewUpdates.push({ id: thread.id, views });
        ranking.push({ id: thread.id, score: computeThreadSmartScore(stats),
          publishedAt: (thread.publishedAt ?? thread.createdAt).getTime() });
      }
      if (viewUpdates.length) {
        await this.prisma.$executeRaw(Prisma.sql`
          UPDATE threads AS t SET view_count = incoming.views
          FROM (VALUES ${Prisma.join(viewUpdates.map(({ id, views }) => Prisma.sql`(${id}::text, ${views}::integer)`))})
            AS incoming(id, views)
          WHERE t.id = incoming.id AND t.view_count < incoming.views
        `);
      }
      cursor = threads.at(-1)!.id;
      if (threads.length < 100) break;
    }
    ranking.sort((a, b) => b.score - a.score || b.publishedAt - a.publishedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    // ZSET 保存排序序号，避免浮点拼接发布时间造成分数或并列次序误差。
    await this.redis.replaceRanking(SMART_SCORE_ZSET, SMART_SCORE_READY, ranking.map((row) => row.id));
  }
}
