import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/** 通知生产者：将通知任务推入队列 */
@Injectable()
export class NotificationProducer {
  constructor(@InjectQueue('notification') private notificationQueue: Queue) {}

  /** 批量发送通知 */
  async notify(
    type: string,
    recipients: string[],
    content: string,
    opts?: { postId?: string; threadId?: string; fromUserId?: string; payload?: Record<string, any> },
  ) {
    if (recipients.length === 0) return;
    await this.notificationQueue.add(
      type,
      { type, recipients, content, payload: opts?.payload ?? null, ...opts },
      { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } },
    );
  }
}
