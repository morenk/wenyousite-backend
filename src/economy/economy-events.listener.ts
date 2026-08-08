import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationProducer } from '../notifications/notification.producer';
import { RedisService } from '../redis/redis.service';
import { updateThreadSmartScore } from '../threads/thread-smart-score';

interface TipCompletedEvent {
  transactionId: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  targetType: 'THREAD' | 'USER' | 'MOMENT';
  threadId?: string | null;
  threadTitle?: string | null;
  grossAmount: string;
  recipientAmount: string;
  platformAmount: string;
  threadTipTotal?: string | null;
  momentId?: string | null;
  momentTitle?: string | null;
  momentTipTotal?: string | null;
}

@Injectable()
export class EconomyEventsListener {
  constructor(
    private readonly notifications: NotificationProducer,
    private readonly redis: RedisService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('tip.completed')
  async handleTipCompleted(event: TipCompletedEvent) {
    const targetLabel = event.targetType === 'THREAD' && event.threadTitle
      ? `你的主题帖「${event.threadTitle}」`
      : event.targetType === 'MOMENT' && event.momentTitle
        ? `你的动态「${event.momentTitle}」`
        : '你';
    await this.notifications.notify(
      'tip',
      [event.recipientId],
      `${event.senderUsername} 向${targetLabel}打赏了 ${event.grossAmount} 升温油（到账 ${event.recipientAmount} 升）`,
      {
        threadId: event.threadId ?? undefined,
        momentId: event.momentId ?? undefined,
        fromUserId: event.senderId,
        eventKey: `tip:${event.transactionId}`,
        payload: {
          schemaVersion: 1,
          action: 'tip',
          actorId: event.senderId,
          actorName: event.senderUsername,
          threadTitle: event.threadTitle ?? null,
          momentTitle: event.momentTitle ?? null,
          grossAmount: event.grossAmount,
          recipientAmount: event.recipientAmount,
          platformAmount: event.platformAmount,
        },
      },
    );

    if (event.threadId && event.threadTipTotal !== null && event.threadTipTotal !== undefined) {
      await this.redis.hset(`thread:${event.threadId}:stats`, 'tips', event.threadTipTotal);
      await updateThreadSmartScore(this.redis, event.threadId);
      this.events.emit('thread.updated', { threadId: event.threadId });
    }
    if (event.momentId && event.momentTipTotal !== null && event.momentTipTotal !== undefined) {
      this.events.emit('moment.updated', { momentId: event.momentId });
    }
  }
}
