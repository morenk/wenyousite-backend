import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ExperienceEventType } from '@prisma/client';
import { NotificationProducer } from '../notifications/notification.producer';
import { ProgressionService } from './progression.service';

interface PostCreatedExperienceEvent {
  postId: string;
  userId: string;
  isSubthreadBody?: boolean;
  occurredAt?: string;
}

interface ThreadPublishedExperienceEvent {
  threadId: string;
  ownerId: string;
  occurredAt?: string;
}

interface ThreadLikedExperienceEvent {
  threadId: string;
  ownerId: string;
  userId: string;
  occurredAt?: string;
}

interface LevelUpEvent {
  userId: string;
  previousLevel: number;
  level: number;
  experience: number;
}

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

  @OnEvent('post.created')
  async handlePostCreated(event: PostCreatedExperienceEvent) {
    if (event.isSubthreadBody) return;
    await this.progression.grant({
      userId: event.userId,
      type: ExperienceEventType.POST_CREATED,
      idempotencyKey: `experience:post-created:${event.postId}`,
      occurredAt: occurredAt(event.occurredAt),
      sourceType: 'Post',
      sourceId: event.postId,
    });
  }

  @OnEvent('thread.published')
  async handleThreadPublished(event: ThreadPublishedExperienceEvent) {
    await this.progression.grant({
      userId: event.ownerId,
      type: ExperienceEventType.THREAD_PUBLISHED,
      idempotencyKey: `experience:thread-published:${event.threadId}`,
      occurredAt: occurredAt(event.occurredAt),
      sourceType: 'Thread',
      sourceId: event.threadId,
    });
  }

  @OnEvent('thread.liked')
  async handleThreadLiked(event: ThreadLikedExperienceEvent) {
    if (event.ownerId === event.userId) return;
    await this.progression.grant({
      userId: event.ownerId,
      type: ExperienceEventType.THREAD_LIKED,
      idempotencyKey: `experience:thread-liked:${event.threadId}:${event.userId}`,
      occurredAt: occurredAt(event.occurredAt),
      sourceType: 'ThreadLike',
      sourceId: `${event.threadId}:${event.userId}`,
    });
  }

  @OnEvent('user.level_up')
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
