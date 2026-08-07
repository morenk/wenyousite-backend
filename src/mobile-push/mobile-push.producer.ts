import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';

interface MobilePushJobBase {
  userId: string;
  eventKey: string;
}

export type MobilePushJob =
  | (MobilePushJobBase & {
      kind: 'notification';
      notificationId: string;
    })
  | (MobilePushJobBase & {
      kind: 'direct_message';
      conversationId: string;
      messageId: string;
    });

@Injectable()
export class MobilePushProducer {
  constructor(@InjectQueue('mobile-push') private readonly queue: Queue) {}

  enqueue(job: MobilePushJob) {
    const jobId = `push-${createHash('sha256').update(job.eventKey).digest('hex')}`;
    return this.queue.add(job.kind, job, {
      jobId,
      attempts: 4,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 24 * 7 },
    });
  }
}
