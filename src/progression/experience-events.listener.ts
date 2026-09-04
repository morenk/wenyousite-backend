import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ExperienceEventType } from '@prisma/client';
import { NotificationProducer } from '../notifications/notification.producer';
import { GrantExperienceInput, ProgressionService } from './progression.service';
import { beijingDateKey } from './progression.constants';
import {
  DOMAIN_EVENTS,
  LevelUpEvent,
  MomentCommentCreatedEvent,
  MomentCreatedEvent,
  PostCreatedEvent,
  TipCompletedEvent,
  ThreadLikedEvent,
  ThreadPublishedEvent,
} from '../outbox/domain-events';

function occurredAt(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

@Injectable()
export class ExperienceEventsListener {
  constructor(
    private readonly progression: ProgressionService,
    private readonly notifications: NotificationProducer,
  ) {}

  private reward(
    userId: string,
    type: GrantExperienceInput['type'],
    idempotencyKey: string,
    at: Date | undefined,
    sourceType: string,
    sourceId: string,
  ): GrantExperienceInput {
    return {
      userId,
      type,
      idempotencyKey,
      occurredAt: at,
      sourceType,
      sourceId,
    };
  }

  private dailyActivity(userId: string, at: Date | undefined, sourceId: string) {
    const dateKey = beijingDateKey(at);
    return this.reward(
      userId,
      ExperienceEventType.DAILY_CHECK_IN,
      `experience:daily-activity:${userId}:${dateKey}`,
      at,
      'DailyActivity',
      sourceId,
    );
  }

  @OnEvent(DOMAIN_EVENTS.POST_CREATED)
  async handlePostCreated(event: PostCreatedEvent) {
    if (event.isSubthreadBody) return;
    const at = occurredAt(event.occurredAt);
    const dateKey = beijingDateKey(at);
    const grants = [
      this.dailyActivity(event.userId, at, event.postId),
      this.reward(
        event.userId,
        ExperienceEventType.POST_CREATED,
        `experience:post-created:${event.postId}`,
        at,
        'Post',
        event.postId,
      ),
    ];
    if (event.threadOwnerId && event.threadOwnerId !== event.userId) {
      grants.push(
        this.reward(
          event.threadOwnerId,
          ExperienceEventType.THREAD_REPLY_RECEIVED,
          `experience:thread-reply-received:${event.threadOwnerId}:${event.userId}:${dateKey}`,
          at,
          'Post',
          `${event.threadId}:${event.postId}`,
        ),
      );
      if (event.threadVisibility === 'PRIVATE') {
        grants.push(
          this.reward(
            event.threadOwnerId,
            ExperienceEventType.PRIVATE_THREAD_ACTIVATED,
            `experience:private-thread-activated:${event.threadId}`,
            at,
            'Thread',
            event.threadId,
          ),
        );
      }
    }
    await this.progression.grantMany(grants);
  }

  @OnEvent(DOMAIN_EVENTS.THREAD_PUBLISHED)
  async handleThreadPublished(event: ThreadPublishedEvent) {
    const at = occurredAt(event.occurredAt);
    if (event.visibility === 'PRIVATE') {
      await this.progression.grantMany([this.dailyActivity(event.ownerId, at, event.threadId)]);
      return;
    }
    await this.progression.grantMany([
      this.dailyActivity(event.ownerId, at, event.threadId),
      this.reward(
        event.ownerId,
        ExperienceEventType.THREAD_PUBLISHED,
        `experience:thread-published:${event.threadId}`,
        at,
        'Thread',
        event.threadId,
      ),
    ]);
  }

  @OnEvent(DOMAIN_EVENTS.MOMENT_CREATED)
  async handleMomentCreated(event: MomentCreatedEvent) {
    const at = occurredAt(event.occurredAt);
    await this.progression.grantMany([
      this.dailyActivity(event.authorId, at, event.momentId),
      this.reward(
        event.authorId,
        ExperienceEventType.MOMENT_PUBLISHED,
        `experience:moment-published:${event.momentId}`,
        at,
        'Moment',
        event.momentId,
      ),
    ]);
  }

  @OnEvent(DOMAIN_EVENTS.THREAD_LIKED)
  async handleThreadLiked(event: ThreadLikedEvent) {
    if (event.ownerId === event.userId) return;
    const at = occurredAt(event.occurredAt);
    await this.progression.grantMany([
      this.dailyActivity(event.userId, at, event.threadId),
      this.reward(
        event.ownerId,
        ExperienceEventType.THREAD_LIKED,
        `experience:thread-liked:${event.threadId}:${event.userId}`,
        at,
        'ThreadLike',
        `${event.threadId}:${event.userId}`,
      ),
    ]);
  }

  @OnEvent(DOMAIN_EVENTS.MOMENT_COMMENT_CREATED)
  async handleMomentCommentCreated(event: MomentCommentCreatedEvent) {
    if (event.momentAuthorId === event.actorId) return;
    const at = occurredAt(event.occurredAt);
    const grants = [
      this.dailyActivity(event.actorId, at, event.commentId),
      this.reward(
        event.actorId,
        ExperienceEventType.MOMENT_COMMENT_CREATED,
        `experience:moment-comment-created:${event.commentId}`,
        at,
        'MomentComment',
        event.commentId,
      ),
    ];
    if (event.momentAuthorId) {
      const dateKey = beijingDateKey(at);
      grants.push(
        this.reward(
          event.momentAuthorId,
          ExperienceEventType.MOMENT_REPLY_RECEIVED,
          `experience:moment-reply-received:${event.momentAuthorId}:${event.actorId}:${dateKey}`,
          at,
          'MomentComment',
          `${event.momentId}:${event.commentId}`,
        ),
      );
    }
    await this.progression.grantMany(grants);
  }

  @OnEvent(DOMAIN_EVENTS.TIP_COMPLETED)
  async handleTipCompleted(event: TipCompletedEvent) {
    if (event.senderId === event.recipientId) return;
    const at = occurredAt(event.occurredAt);
    const dateKey = beijingDateKey(at);
    await this.progression.grantMany([
      this.dailyActivity(event.senderId, at, event.transactionId),
      this.reward(
        event.senderId,
        ExperienceEventType.TIP_SENT,
        `experience:tip-sent:${event.senderId}:${event.recipientId}:${dateKey}`,
        at,
        'WalletTransaction',
        event.transactionId,
      ),
      this.reward(
        event.recipientId,
        ExperienceEventType.TIP_RECEIVED,
        `experience:tip-received:${event.recipientId}:${event.senderId}:${dateKey}`,
        at,
        'WalletTransaction',
        event.transactionId,
      ),
    ]);
  }

  @OnEvent(DOMAIN_EVENTS.USER_LEVEL_UP)
  async handleLevelUp(event: LevelUpEvent) {
    await this.notifications.notify('level_up', [event.userId], `恭喜你升级到 Lv.${event.level}`, {
      eventKey: `level-up:${event.userId}:${event.level}:${event.experience}`,
      payload: {
        schemaVersion: 1,
        action: 'level_up',
        previousLevel: event.previousLevel,
        level: event.level,
        experience: event.experience,
      },
    });
  }
}
