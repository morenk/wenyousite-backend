import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationType } from '@prisma/client';

export interface NotificationJob {
  type: NotificationType;
  recipients: string[];
  content: string;
  postId?: string;
  threadId?: string;
  momentId?: string;
  momentCommentId?: string;
  fromUserId?: string;
  payload?: Record<string, unknown> | null;
  eventKey?: string;
  campaignId?: string;
}

/** 通知生产者：将通知任务推入队列 */
@Injectable()
export class NotificationProducer {
  constructor(@InjectQueue('notification') private notificationQueue: Queue) {}

  /** 批量发送通知 */
  async notify(
    type: NotificationType,
    recipients: string[],
    content: string,
    opts?: {
      postId?: string;
      threadId?: string;
      momentId?: string;
      momentCommentId?: string;
      fromUserId?: string;
      payload?: Record<string, unknown>;
      /** 同一业务事件的稳定键；处理器会按收件人拼接，保证队列重试幂等。 */
      eventKey?: string;
      campaignId?: string;
    },
  ) {
    if (recipients.length === 0) return;
    await this.notificationQueue.add(
      type,
      { type, recipients, content, payload: opts?.payload ?? null, ...opts },
      { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } },
    );
  }
}
