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

  /** 监听 post.created 事件，处理：@提及、新楼层通知、楼中楼回复通知、新子贴通知 */
  @OnEvent('post.created')
  async handlePostCreated(event: PostCreatedEvent) {
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
    const preview = truncate(event.content);

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
            { postId: event.postId, threadId: event.threadId, fromUserId: event.userId },
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
            { postId: event.postId, threadId: event.threadId, fromUserId: event.userId },
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
            { postId: event.postId, threadId: event.threadId, fromUserId: event.userId },
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
            .filter(id => !authorBlockedIds.has(id));
          if (recipients.length > 0) {
            await this.notificationProducer.notify(
              'reply',
              recipients,
              `${username} 回复了：${preview}`,
              { postId: event.postId, threadId: event.threadId, fromUserId: event.userId },
            );
          }
        }
      }
    } catch (e) { this.logger.error('reply notification failed', e); }
  }
}

/** 截取通知正文预览（前100字） */
function truncate(content: string): string {
  if (!content || content.length <= 100) return content || '';
  return content.slice(0, 100) + '...';
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
