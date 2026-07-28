import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MentionsService } from '../mentions/mentions.service';
import { NotificationProducer } from './notification.producer';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

/** 发帖事件监听器：PostCreated → @提及解析 + 通知队列投递 */
@Injectable()
export class PostEventsListener {
  private readonly logger = new Logger(PostEventsListener.name);

  constructor(
    private mentionsService: MentionsService,
    private notificationProducer: NotificationProducer,
    private subscriptionsService: SubscriptionsService,
    private prisma: PrismaService,
  ) {}

  /** 监听 post.created 事件，处理三类通知：@提及、新楼层通知楼主协作者及订阅者、楼中楼回复通知被回复者及楼主协作者及订阅者 */
  @OnEvent('post.created')
  async handlePostCreated(event: PostCreatedEvent) {
    // 预加载拉黑关系和订阅者（三类通知共用，一次 DB 查询）
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
    // 1. @提及：解析正文中的 @用户名，验证权限规则，过滤拉黑，入队通知
    try {
      const mentionedUsers = await this.mentionsService.parseAndCreate(
        event.postId, event.content, event.userId, event.threadId,
      );
      if (mentionedUsers.length > 0) {
        // 过滤：被 @ 的用户如果拉黑了发帖人，不通知
        const filtered = mentionedUsers.filter(u => !blockedAuthorIds.has(u.userId));
        if (filtered.length > 0) {
          await this.notificationProducer.notify(
            'mention',
            filtered.map(u => u.userId),
            `在 ${event.subthreadTitle} 中提到了你`,
            { postId: event.postId, threadId: event.threadId, fromUserId: event.userId },
          );
        }
      }
    } catch (e) { this.logger.error('mention processing failed', e); }

    // 2. 新楼层：通知楼主协作者 + 订阅者（排除自己，过滤拉黑）
    try {
      if (!event.parentPostId) {
        const managers = await this.prisma.threadMember.findMany({
          where: {
            threadId: event.threadId,
            role: { in: ['OWNER', 'COLLABORATOR'] },
            userId: { not: event.userId },
          },
          select: { userId: true },
        });
        const managerIds = managers.map(m => m.userId);
        // 合并：楼主协作者 + 订阅者（去重）
        const recipients = [...new Set([...managerIds, ...subscriberIds])]
          .filter(id => !authorBlockedIds.has(id));
        if (recipients.length > 0) {
          await this.notificationProducer.notify(
            'new_floor',
            recipients,
            `${event.subthreadTitle} 有新楼层`,
            { postId: event.postId, threadId: event.threadId, fromUserId: event.userId },
          );
        }
      }
    } catch (e) { this.logger.error('new floor notification failed', e); }

    // 3. 楼中楼回复：通知被回复者 + 楼主协作者 + 订阅者（排除自己，过滤拉黑）
    try {
      if (event.replyToPostId) {
        const targetPost = await this.prisma.post.findUnique({
          where: { id: event.replyToPostId },
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
          // 合并：被回复者 + 楼主协作者 + 订阅者（去重、排除自己、过滤拉黑）
          const recipients = [...new Set([replyTargetId, ...managerIds, ...subscriberIds])]
            .filter(id => !authorBlockedIds.has(id));
          if (recipients.length > 0) {
            await this.notificationProducer.notify(
              'reply',
              recipients,
              `有人在 ${event.subthreadTitle} 回复了`,
              { postId: event.postId, threadId: event.threadId, fromUserId: event.userId },
            );
          }
        }
      }
    } catch (e) { this.logger.error('reply notification failed', e); }
  }
}

export interface PostCreatedEvent {
  postId: string;
  content: string;
  userId: string;
  threadId: string;
  subthreadId: string;
  subthreadTitle: string;
  parentPostId: string | null;
  replyToPostId: string | null;
}
