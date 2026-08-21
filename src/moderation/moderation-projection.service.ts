import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { computeThreadEngagement, computeThreadSmartScore } from '../threads/thread-smart-score';

const ZSET_BY_CREATED = 'threads:by:created';
const ZSET_BY_ACTIVITY = 'threads:by:activity';
const ZSET_BY_SMART = 'threads:by:smart';

export interface ContentModerationEffect {
  targetType: 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT';
  targetId: string;
  hidden: boolean;
  deletedAt: Date | null;
  threadId?: string;
  momentId?: string;
  parentPostId?: string | null;
}

/** 治理命令提交后的缓存投影与进程内失效事件。 */
@Injectable()
export class ModerationProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly redis: RedisService,
  ) {}

  finalizeUser(userId: string) {
    this.events.emit('user.updated', { userId });
  }

  async finalizeContent(effect: ContentModerationEffect) {
    if (effect.targetType === 'THREAD') {
      if (effect.hidden) {
        await Promise.all([
          this.redis.zrem(ZSET_BY_CREATED, effect.targetId),
          this.redis.zrem(ZSET_BY_ACTIVITY, effect.targetId),
          this.redis.zrem(ZSET_BY_SMART, effect.targetId),
          this.redis.hdelAll(`thread:${effect.targetId}:stats`),
        ]).catch(() => undefined);
        this.events.emit('thread.deleted', { threadId: effect.targetId });
      } else {
        await this.restoreThread(effect.targetId);
        this.events.emit('thread.updated', { threadId: effect.targetId });
      }
      return;
    }
    if (effect.targetType === 'MOMENT' || effect.targetType === 'MOMENT_COMMENT') {
      this.events.emit('moment.updated', {
        momentId: effect.momentId ?? effect.targetId,
      });
      return;
    }
    this.events.emit(effect.hidden ? 'post.deleted' : 'post.updated', {
      postId: effect.targetId,
      threadId: effect.threadId,
      parentPostId: effect.parentPostId,
    });
  }

  private async restoreThread(threadId: string) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: {
        id: true,
        published: true,
        createdAt: true,
        updatedAt: true,
        viewCount: true,
        likeCount: true,
        tipTotal: true,
        _count: { select: { posts: { where: { deletedAt: null, kind: 'FLOOR' } } } },
      },
    });
    if (!thread?.published) return;
    const replies = thread._count.posts;
    const tips = Number(thread.tipTotal);
    const ageHours = Math.max(0, Date.now() - thread.createdAt.getTime()) / 3_600_000;
    const smart = computeThreadSmartScore(
      computeThreadEngagement({
        views: thread.viewCount,
        replies,
        likes: thread.likeCount,
        tips,
      }),
      ageHours,
    );
    await Promise.all([
      this.redis.zadd(ZSET_BY_CREATED, thread.createdAt.getTime(), threadId),
      this.redis.zadd(ZSET_BY_ACTIVITY, thread.updatedAt.getTime(), threadId),
      this.redis.zadd(ZSET_BY_SMART, smart, threadId),
      this.redis.hset(`thread:${threadId}:stats`, 'views', thread.viewCount),
      this.redis.hset(`thread:${threadId}:stats`, 'replies', replies),
      this.redis.hset(`thread:${threadId}:stats`, 'likes', thread.likeCount),
      this.redis.hset(`thread:${threadId}:stats`, 'tips', tips),
      this.redis.hset(`thread:${threadId}:stats`, 'createdAt', thread.createdAt.getTime()),
    ]).catch(() => undefined);
  }
}
