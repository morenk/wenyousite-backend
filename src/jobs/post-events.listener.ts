import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MentionsService } from '../mentions/mentions.service';
import { NotificationProducer } from './notification.producer';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { truncateMarkdown } from '../common/markdown-truncate';

/** ZSET 键名 */
const ZSET_BY_ACTIVITY = 'threads:by:activity';
const ZSET_BY_SMART = 'threads:by:smart';

/** 智能排序分计算：Hacker News 变体 */
function computeSmartScore(engagement: number, ageHours: number): number {
  return engagement / Math.pow(ageHours + 2, 1.5);
}

/** 从 Redis Hash 读取统计值计算智能排序分 */
async function updateSmartScore(redis: RedisService, threadId: string): Promise<number> {
  const stats = await redis.hgetall(`thread:${threadId}:stats`);
  const views = parseInt(stats?.views ?? '0', 10);
  const replies = parseInt(stats?.replies ?? '0', 10);
  const likes = parseInt(stats?.likes ?? '0', 10);
  const createdAt = parseInt(stats?.createdAt ?? '0', 10);
  if (!createdAt) return 0;

  const ageHours = (Date.now() - createdAt) / 3600000;
  const engagement = replies * 2 + likes * 3 + views * 0.3;
  const score = computeSmartScore(engagement, ageHours);
  await redis.zadd(ZSET_BY_SMART, score, threadId);
  return score;
}

/** 发帖事件监听器：PostCreated → @提及解析 + 通知队列投递 + Redis 计数器/SortedSet 更新 */
@Injectable()
export class PostEventsListener {
  private readonly logger = new Logger(PostEventsListener.name);

  constructor(
    private mentionsService: MentionsService,
    private notificationProducer: NotificationProducer,
    private subscriptionsService: SubscriptionsService,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /** 监听 post.created 事件，处理：@提及、新楼层通知、楼中楼回复通知、新子贴通知 + Redis 计数器更新 */
  @OnEvent('post.created')
  async handlePostCreated(event: PostCreatedEvent) {
    // Redis: 更新回复计数器 + 帖子活跃度 ZSET + 智能排序分
    this.redis.hincrby(`thread:${event.threadId}:stats`, 'replies', 1).catch(() => {});
    if (event.parentPostId) {
      this.redis.hincrby(`post:${event.parentPostId}:stats`, 'replies', 1).catch(() => {});
    }
    const now = Date.now();
    this.redis.zadd(ZSET_BY_ACTIVITY, now, event.threadId).catch(() => {});
    updateSmartScore(this.redis, event.threadId).catch(() => {});

    // 预加载拉黑关系和订阅者（多类通知共用，一次 DB 查询）
    const [subscribers, blockedByAuthor, blocksOfAuthor] = await Promise.all([
      this.subscriptionsService.findSubscribers(
        event.threadId, event.userId, event.userId,
      ),
      this.prisma.userBlock.findMany({
        where: { blockedId: event.userId },
        select: { blockerId: true },
      }),
      this.prisma.userBlock.findMany({
        where: { blockerId: event.userId },
        select: { blockedId: true },
      }),
    ]);
    const subscriberIds = subscribers.map(s => s.userId);
    const blockedAuthorIds = new Set(blockedByAuthor.map(b => b.blockerId));
    const authorBlockedIds = new Set(blocksOfAuthor.map(b => b.blockedId));

    const username = event.authorUsername ?? '有人';
    const preview = truncateMarkdown(event.content);

    // 1. @提及：解析正文中的 @用户名，验证权限规则，过滤拉黑，入队通知
    try {
      const mentionedUsers = await this.mentionsService.parseAndCreate(
        event.postId, event.content, event.userId, event.threadId,
      );
      if (mentionedUsers.length > 0) {
        const filtered = mentionedUsers.filter(u => !blockedAuthorIds.has(u.userId));
        if (filtered.length > 0) {
          await this.notificationProducer.notify(
            'mention',
            filtered.map(u => u.userId),
            `${username} 在「${event.subthreadTitle}」提到了你：${preview}`,
            { postId: event.postId, threadId: event.threadId, fromUserId: event.userId,
              payload: { actorName: username, action: 'mention', preview, subthreadTitle: event.subthreadTitle } },
          );
        }
      }
    } catch (e) { this.logger.error('mention processing failed', e); }

    // 2. 新子贴正文：通知订阅者 + 楼主 + 协作者（排除自己，过滤拉黑）
    if (event.isSubthreadBody) {
      try {
        const managers = await this.prisma.threadMember.findMany({
          where: {
            threadId: event.threadId,
            role: { in: ['OWNER', 'COLLABORATOR'] },
            userId: { not: event.userId },
          },
          select: { userId: true },
        });
        const managerIds = managers.map(m => m.userId);
        const recipients = [...new Set([...managerIds, ...subscriberIds])]
          .filter(id => !authorBlockedIds.has(id) && !blockedAuthorIds.has(id));
        if (recipients.length > 0) {
          await this.notificationProducer.notify(
            'subthread_created',
            recipients,
            `${username} 创建了新子贴「${event.subthreadTitle}」：${preview}`,
            { postId: event.postId, threadId: event.threadId, fromUserId: event.userId,
              payload: { actorName: username, action: 'subthread_created', preview, subthreadTitle: event.subthreadTitle } },
          );
        }
      } catch (e) { this.logger.error('subthread created notification failed', e); }
    }

    // 3. 新楼层：通知楼主协作者 + 订阅者（排除自己，过滤拉黑）
    try {
      if (!event.parentPostId && !event.isSubthreadBody) {
        const managers = await this.prisma.threadMember.findMany({
          where: {
            threadId: event.threadId,
            role: { in: ['OWNER', 'COLLABORATOR'] },
            userId: { not: event.userId },
          },
          select: { userId: true },
        });
        const managerIds = managers.map(m => m.userId);
        const recipients = [...new Set([...managerIds, ...subscriberIds])]
          .filter(id => !authorBlockedIds.has(id) && !blockedAuthorIds.has(id));
        if (recipients.length > 0) {
          await this.notificationProducer.notify(
            'new_floor',
            recipients,
            `${username} 发布了新楼层：${preview}`,
            { postId: event.postId, threadId: event.threadId, fromUserId: event.userId,
              payload: { actorName: username, action: 'new_floor', preview } },
          );
        }
      }
    } catch (e) { this.logger.error('new floor notification failed', e); }

    // 4. 楼中楼回复：通知被回复者 + 楼主协作者 + 订阅者（排除自己，过滤拉黑）
    try {
      if (event.parentPostId && !event.isSubthreadBody) {
        const targetId = event.replyToPostId ?? event.parentPostId;
        const targetPost = await this.prisma.post.findUnique({
          where: { id: targetId, deletedAt: null },
          select: { authorId: true },
        });
        if (targetPost && targetPost.authorId !== event.userId) {
          const managers = await this.prisma.threadMember.findMany({
            where: {
              threadId: event.threadId,
              role: { in: ['OWNER', 'COLLABORATOR'] },
              userId: { not: event.userId },
            },
            select: { userId: true },
          });
          const managerIds = managers.map(m => m.userId);
          const replyTargetId = targetPost.authorId;
          const recipients = [...new Set([replyTargetId, ...managerIds, ...subscriberIds])]
            .filter(id => !authorBlockedIds.has(id) && !blockedAuthorIds.has(id));
          if (recipients.length > 0) {
            await this.notificationProducer.notify(
              'reply',
              recipients,
              `${username} 回复了：${preview}`,
              { postId: event.postId, threadId: event.threadId, fromUserId: event.userId,
                payload: { actorName: username, action: 'reply', preview } },
            );
          }
        }
      }
    } catch (e) { this.logger.error('reply notification failed', e); }
  }

  /** 点赞后更新点赞计数 + 智能排序分 */
  @OnEvent('post.liked')
  async handlePostLiked(event: { postId: string; threadId: string }) {
    this.redis.hincrby(`thread:${event.threadId}:stats`, 'likes', 1).catch(() => {});
    updateSmartScore(this.redis, event.threadId).catch(() => {});
  }

  /** 取消点赞后更新计数 */
  @OnEvent('post.unliked')
  async handlePostUnliked(event: { postId: string; threadId: string }) {
    this.redis.hincrby(`thread:${event.threadId}:stats`, 'likes', -1).catch(() => {});
    updateSmartScore(this.redis, event.threadId).catch(() => {});
  }
}

export interface PostCreatedEvent {
  postId: string;
  content: string;
  userId: string;
  authorUsername?: string;
  threadId: string;
  subthreadId: string;
  subthreadTitle: string;
  parentPostId: string | null;
  replyToPostId: string | null;
  isSubthreadBody?: boolean;
}
