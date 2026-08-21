import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationProducer } from '../notifications/notification.producer';
import { DOMAIN_EVENTS, MomentCommentCreatedEvent } from '../outbox/domain-events';

@Injectable()
export class MomentEventsListener {
  constructor(private readonly notifications: NotificationProducer) {}

  @OnEvent(DOMAIN_EVENTS.MOMENT_COMMENT_CREATED)
  async commentCreated(event: MomentCommentCreatedEvent) {
    await this.notifications.notify(
      'reply',
      [event.recipientId],
      event.isReply
        ? `${event.actorUsername} 回复了你在动态「${event.momentTitle}」中的评论`
        : `${event.actorUsername} 评论了你的动态「${event.momentTitle}」`,
      {
        momentId: event.momentId,
        momentCommentId: event.commentId,
        fromUserId: event.actorId,
        eventKey: `moment-comment:${event.commentId}`,
        payload: {
          schemaVersion: 1,
          action: event.isReply ? 'moment_reply' : 'moment_comment',
          actorId: event.actorId,
          actorName: event.actorUsername,
          momentTitle: event.momentTitle,
        },
      },
    );
  }
}
