import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MentionsService } from '../mentions/mentions.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { BlockFilterService } from '../access/block-filter.service';
import { buildPostPreview } from '../common/post-preview';

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
    private blockFilter: BlockFilterService,
  ) {}

  /** 监听 post.created 事件，处理：@提及、新帖通知、楼中楼回复通知 + Redis 计数器更新 */
  @OnEvent('post.created')
  async handlePostCreated(event: PostCreatedEvent) {
    const failures: unknown[] = [];
    // Redis 投影从数据库权威值覆盖，Outbox 重试时不会重复累加。
    await this.refreshReplyProjection(event).catch(() => {});
    const now = Date.now();
    this.redis.zadd(ZSET_BY_ACTIVITY, now, event.threadId).catch(() => {});
    updateSmartScore(this.redis, event.threadId).catch(() => {});

    // 预加载拉黑关系、订阅者、管理者（多类通知共用，一次 DB 查询）
    const [subscribers, blockSets, managers] = await Promise.all([
      this.subscriptionsService.findSubscribers(event.threadId, event.userId, event.userId),
      this.blockFilter.loadBlockSets(event.userId),
      this.prisma.threadMember.findMany({
        where: {
          threadId: event.threadId,
          role: { in: ['OWNER', 'COLLABORATOR'] },
        },
        select: { userId: true },
      }),
    ]);
    // 角色取发帖时快照，避免异步处理期间的角色变化改变本次通知语义。
    const managerIdSet = new Set(managers.map((m) => m.userId));
    const authorIsManager = event.authorRole === 'OWNER' || event.authorRole === 'COLLABORATOR';
    const authorIsEligiblePlayer = event.authorRole === 'PARTICIPANT' && event.authorPlayerMarked;
    const managerIds = [...managerIdSet].filter((id) => id !== event.userId);
    const subscriberIds = subscribers
      .filter(
        (s) =>
          (s.type === 'THREAD' && authorIsManager) || (s.type === 'USER' && authorIsEligiblePlayer),
      )
      .map((s) => s.userId);

    const username = event.authorUsername ?? '有人';
    const preview = buildPostPreview(event.content, event.diceRolls);
    const explicitMentionRecipientIds = new Set<string>();

    // 1. @提及：解析正文中的 @用户名，验证权限规则，双向过滤拉黑，入队通知
    try {
      const mentionedUsers = await this.mentionsService.parseAndCreate(
        event.postId,
        event.content,
        event.userId,
        event.threadId,
      );
      if (mentionedUsers.length > 0) {
        const filteredIds = this.blockFilter.filterRecipients(
          mentionedUsers.map((u) => u.userId),
          blockSets,
        );
        if (filteredIds.length > 0) {
          filteredIds.forEach((id) => explicitMentionRecipientIds.add(id));
          await this.notificationProducer.notify(
            'mention',
            filteredIds,
            `${username} 在「${event.subthreadTitle}」提到了你：${preview}`,
            {
              postId: event.postId,
              threadId: event.threadId,
              fromUserId: event.userId,
              eventKey: `mention:${event.postId}`,
              payload: {
                actorName: username,
                action: 'mention',
                preview,
                subthreadTitle: event.subthreadTitle,
              },
            },
          );
        }
      }
    } catch (e) {
      this.logger.error('mention processing failed', e);
      failures.push(e);
    }

    // 2. 新帖通知（子贴正文 / 新楼层）：通知楼主 + 协作者 + 订阅者（排除自己，过滤拉黑）
    if (!event.parentPostId || event.isSubthreadBody) {
      try {
        const recipients = this.blockFilter.filterRecipients(
          [...new Set([...managerIds, ...subscriberIds])].filter(
            (id) => !explicitMentionRecipientIds.has(id),
          ),
          blockSets,
        );
        if (recipients.length > 0) {
          const isSubthread = event.isSubthreadBody === true;
          const content = isSubthread
            ? `${username} 创建了新子贴「${event.subthreadTitle}」：${preview}`
            : `${username} 发布了新楼层：${preview}`;
          await this.notificationProducer.notify('new_post', recipients, content, {
            postId: event.postId,
            threadId: event.threadId,
            fromUserId: event.userId,
            eventKey: `new-post:${event.postId}`,
            payload: {
              actorName: username,
              action: 'new_post',
              preview,
              ...(isSubthread ? { subthreadTitle: event.subthreadTitle } : {}),
            },
          });
        }
      } catch (e) {
        this.logger.error('new_post notification failed', e);
        failures.push(e);
      }
    }

    // 3. 楼中楼回复：通知被回复者 + 楼主协作者 + 订阅者（排除自己，过滤拉黑）
    try {
      if (event.parentPostId && !event.isSubthreadBody) {
        const targetId = event.replyToPostId ?? event.parentPostId;
        const targetPost = await this.prisma.post.findUnique({
          where: { id: targetId, deletedAt: null },
          select: { authorId: true },
        });
        if (targetPost && targetPost.authorId !== event.userId) {
          const replyTargetId = targetPost.authorId;
          const recipients = this.blockFilter.filterRecipients(
            [...new Set([replyTargetId, ...managerIds, ...subscriberIds])].filter(
              (id) => !explicitMentionRecipientIds.has(id),
            ),
            blockSets,
          );
          if (recipients.length > 0) {
            await this.notificationProducer.notify(
              'reply',
              recipients,
              `${username} 回复了：${preview}`,
              {
                postId: event.postId,
                threadId: event.threadId,
                fromUserId: event.userId,
                eventKey: `reply:${event.postId}`,
                payload: { actorName: username, action: 'reply', preview },
              },
            );
          }
        }
      }
    } catch (e) {
      this.logger.error('reply notification failed', e);
      failures.push(e);
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, 'post.created event processing failed');
    }
  }

  /** 主题帖点赞后更新计数 + 智能排序分 */
  @OnEvent('thread.liked')
  async handleThreadLiked(event: { threadId: string }) {
    const thread = await this.prisma.thread.findUnique({
      where: { id: event.threadId },
      select: { likeCount: true },
    });
    if (!thread) return;
    await this.redis.hset(
      `thread:${event.threadId}:stats`,
      'likes',
      String(thread.likeCount),
    );
    updateSmartScore(this.redis, event.threadId).catch(() => {});
  }

  /** 主题帖取消点赞后更新计数 */
  @OnEvent('thread.unliked')
  async handleThreadUnliked(event: { threadId: string }) {
    await this.handleThreadLiked(event);
  }

  private async refreshReplyProjection(event: PostCreatedEvent): Promise<void> {
    const [threadReplies, parentReplies] = await Promise.all([
      this.prisma.post.count({
        where: {
          threadId: event.threadId,
          deletedAt: null,
          subthread: { deletedAt: null },
        },
      }),
      event.parentPostId
        ? this.prisma.post.count({
            where: { parentPostId: event.parentPostId, deletedAt: null },
          })
        : Promise.resolve(null),
    ]);
    await this.redis.hset(
      `thread:${event.threadId}:stats`,
      'replies',
      String(threadReplies),
    );
    if (event.parentPostId && parentReplies !== null) {
      await this.redis.hset(
        `post:${event.parentPostId}:stats`,
        'replies',
        String(parentReplies),
      );
    }
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
  authorRole: 'OWNER' | 'COLLABORATOR' | 'PARTICIPANT';
  authorPlayerMarked: boolean;
  diceRolls?: { nodeId: string; notation: string; total: number }[];
}
