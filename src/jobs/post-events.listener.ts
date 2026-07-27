import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MentionsService } from '../mentions/mentions.service';
import { NotificationProducer } from './notification.producer';
import { PrismaService } from '../prisma/prisma.service';

/** 发帖事件监听器：PostCreated → @提及解析 + 通知队列投递 */
@Injectable()
export class PostEventsListener {
  private readonly logger = new Logger(PostEventsListener.name);

  constructor(
    private mentionsService: MentionsService,
    private notificationProducer: NotificationProducer,
    private prisma: PrismaService,
  ) {}

  /** 监听 post.created 事件，处理三类通知：@提及、新楼层通知楼主协作者、楼中楼回复通知被回复者 */
  @OnEvent('post.created')
  async handlePostCreated(event: PostCreatedEvent) {
    // 1. @提及：解析正文中的 @用户名，验证权限规则，过滤拉黑，入队通知
    try {
      const mentionedUsers = await this.mentionsService.parseAndCreate(
        event.postId, event.content, event.userId, event.threadId,
      );
      if (mentionedUsers.length > 0) {
        // 过滤：被 @ 的用户如果拉黑了发帖人，不通知
        const blocks = await this.prisma.userBlock.findMany({
          where: { blockedId: event.userId, blockerId: { in: mentionedUsers.map(u => u.userId) } },
          select: { blockerId: true },
        });
        const blockedIds = new Set(blocks.map(b => b.blockerId));
        const filtered = mentionedUsers.filter(u => !blockedIds.has(u.userId));
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

    // 2. 新楼层：通知楼主和协作者（排除发帖人自己，过滤拉黑）
    try {
      if (!event.parentPostId) {
        const members = await this.prisma.threadMember.findMany({
          where: {
            threadId: event.threadId,
            role: { in: ['OWNER', 'COLLABORATOR'] },
            userId: { not: event.userId },
          },
          select: { userId: true },
        });
        if (members.length > 0) {
          const memberIds = members.map(m => m.userId);
          const blocks = await this.prisma.userBlock.findMany({
            where: { blockerId: { in: memberIds }, blockedId: event.userId },
            select: { blockerId: true },
          });
          const blockedSet = new Set(blocks.map(b => b.blockerId));
          const filtered = memberIds.filter(id => !blockedSet.has(id));
          if (filtered.length > 0) {
            await this.notificationProducer.notify(
              'new_floor',
              filtered,
              `${event.subthreadTitle} 有新楼层`,
              { postId: event.postId, threadId: event.threadId, fromUserId: event.userId },
            );
          }
        }
      }
    } catch (e) { this.logger.error('new floor notification failed', e); }

    // 3. 楼中楼回复：通知被回复者（排除自己，过滤拉黑）
    try {
      if (event.replyToPostId) {
        const targetPost = await this.prisma.post.findUnique({
          where: { id: event.replyToPostId },
          select: { authorId: true },
        });
        if (targetPost && targetPost.authorId !== event.userId) {
          const blocked = await this.prisma.userBlock.findUnique({
            where: { blockerId_blockedId: { blockerId: targetPost.authorId, blockedId: event.userId } },
          });
          if (!blocked) {
            await this.notificationProducer.notify(
              'reply',
              [targetPost.authorId],
              `有人在 ${event.subthreadTitle} 回复了你`,
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
