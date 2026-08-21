import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { BlockFilterService } from '../access/block-filter.service';
import { DOMAIN_EVENTS, ThreadLikedEvent, ThreadPublishedEvent } from '../outbox/domain-events';

/** 将主题领域事件翻译为用户通知；领域写入由 Outbox 保证可靠投递。 */
@Injectable()
export class ThreadEventsListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationProducer,
    private readonly blockFilter: BlockFilterService,
  ) {}

  @OnEvent(DOMAIN_EVENTS.THREAD_PUBLISHED)
  async handlePublished(event: ThreadPublishedEvent): Promise<void> {
    const followers = await this.prisma.userFollow.findMany({
      where: { followingId: event.ownerId },
      select: { followerId: true },
    });
    const followerIds = followers.map((follow) => follow.followerId);
    if (followerIds.length === 0) return;

    const blockSets = await this.blockFilter.loadBlockSets(event.ownerId);
    const recipients = this.blockFilter.filterRecipients(followerIds, blockSets);
    if (recipients.length === 0) return;

    await this.notifications.notify(
      'thread_created',
      recipients,
      `${event.ownerUsername}创建了新主题帖`,
      {
        threadId: event.threadId,
        fromUserId: event.ownerId,
        eventKey: `thread-created:${event.threadId}`,
      },
    );
  }

  @OnEvent(DOMAIN_EVENTS.THREAD_LIKED)
  async handleLiked(event: ThreadLikedEvent): Promise<void> {
    if (event.ownerId === event.userId) return;

    const blockSets = await this.blockFilter.loadBlockSets(event.userId);
    const recipients = this.blockFilter.filterRecipients([event.ownerId], blockSets);
    if (recipients.length === 0) return;

    await this.notifications.notify(
      'like',
      recipients,
      `${event.username} 赞了你的主题帖「${event.threadTitle}」`,
      {
        threadId: event.threadId,
        fromUserId: event.userId,
        eventKey: `like:${event.eventId}`,
        payload: {
          action: 'like',
          actorName: event.username,
          threadTitle: event.threadTitle,
          totalCount: 1,
          likers: [{ userId: event.userId, username: event.username }],
        },
      },
    );
  }
}
