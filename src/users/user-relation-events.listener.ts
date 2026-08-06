import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationProducer } from '../notifications/notification.producer';
import { BlockFilterService } from '../access/block-filter.service';

interface UserFollowedEvent {
  actorId: string;
  actorUsername: string;
  targetId: string;
  notificationEventKey: string;
}

/** 关注事件的通知适配器。 */
@Injectable()
export class UserRelationEventsListener {
  constructor(
    private readonly notifications: NotificationProducer,
    private readonly blockFilter: BlockFilterService,
  ) {}

  @OnEvent('user.followed')
  async handleFollowed(event: UserFollowedEvent): Promise<void> {
    const blockSets = await this.blockFilter.loadBlockSets(event.actorId);
    const recipients = this.blockFilter.filterRecipients([event.targetId], blockSets);
    if (recipients.length === 0) return;

    await this.notifications.notify('follow', recipients, `${event.actorUsername} 关注了你`, {
      fromUserId: event.actorId,
      eventKey: event.notificationEventKey,
    });
  }
}
