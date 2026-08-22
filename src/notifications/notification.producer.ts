import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationDeliveryService } from './notification-delivery.service';

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

/** 通知应用入口：同步等待权威通知落库，移动推送由投递服务尽力提交。 */
@Injectable()
export class NotificationProducer {
  constructor(private readonly delivery: NotificationDeliveryService) {}

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
      /** 同一业务事件的稳定键；投递服务会按收件人拼接，保证 Outbox 重放幂等。 */
      eventKey?: string;
      campaignId?: string;
    },
  ) {
    if (recipients.length === 0) return;
    await this.delivery.deliver({
      type,
      recipients,
      content,
      payload: opts?.payload ?? null,
      ...opts,
    });
  }
}
