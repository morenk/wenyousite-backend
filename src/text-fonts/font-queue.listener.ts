import { FontWorkDirectoryService } from './font-work-directory.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { DOMAIN_EVENTS, DomainEventPayload } from '../outbox/domain-events';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { lockFontState } from './font-domain';

@Injectable()
export class FontQueueListener {
  private recovering = false;
  constructor(
    @InjectQueue('text-font') private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly work: FontWorkDirectoryService,
  ) {}

  @OnEvent(DOMAIN_EVENTS.TEXT_FONT_BUILD_REQUESTED, { suppressErrors: false })
  async enqueue(event: DomainEventPayload<typeof DOMAIN_EVENTS.TEXT_FONT_BUILD_REQUESTED>) {
    await this.queue.add('build', event, {
      jobId: `${event.jobId}-${event.attempt}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  @Interval(30000)
  async recoverExpired(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;
    try {
      for (const ticket of await this.work.abandoned()) {
        if (ticket.ownership.kind === 'import') {
          await this.work.remove(ticket);
          continue;
        }
        const registered = await this.prisma.$transaction(async (tx) => {
          await lockFontState(tx);
          const job = await tx.textFontBuildJob.findUnique({
            where: { id: ticket.ownership.jobId },
          });
          if (!job) return false;
          if (
            job.status === 'PROCESSING' &&
            job.claimToken === ticket.ownership.claim &&
            job.attempt === ticket.ownership.attempt
          ) {
            const next = await tx.textFontBuildJob.update({
              where: { id: job.id },
              data: {
                status: 'QUEUED',
                attempt: { increment: 1 },
                claimToken: null,
                leaseExpiresAt: null,
              },
            });
            await this.outbox.enqueue(tx, {
              eventType: DOMAIN_EVENTS.TEXT_FONT_BUILD_REQUESTED,
              aggregateType: 'text-font',
              aggregateId: job.id,
              eventKey: `text-font-build:${job.id}:${next.attempt}`,
              payload: { jobId: job.id, attempt: next.attempt },
            });
          }
          return true;
        });
        if (registered) await this.work.remove(ticket);
      }
      const queued = await this.prisma.textFontBuildJob.findMany({
        where: { status: 'QUEUED', updatedAt: { lt: new Date(Date.now() - 30000) } },
        take: 20,
      });
      for (const job of queued) {
        const queuedJob = await this.queue.getJob(`${job.id}-${job.attempt}`);
        if (!queuedJob) await this.enqueue({ jobId: job.id, attempt: job.attempt });
        else if (['failed', 'completed'].includes(await queuedJob.getState())) {
          await this.prisma.$transaction(async (tx) => {
            await lockFontState(tx);
            const updated = await tx.textFontBuildJob.updateMany({
              where: { id: job.id, attempt: job.attempt, status: 'QUEUED' },
              data: { attempt: { increment: 1 } },
            });
            if (updated.count)
              await this.outbox.enqueue(tx, {
                eventType: DOMAIN_EVENTS.TEXT_FONT_BUILD_REQUESTED,
                aggregateType: 'text-font',
                aggregateId: job.id,
                eventKey: `text-font-build:${job.id}:${job.attempt + 1}`,
                payload: { jobId: job.id, attempt: job.attempt + 1 },
              });
          });
        }
      }
      await this.prisma.$transaction(async (tx) => {
        await lockFontState(tx);
        const jobs = await tx.textFontBuildJob.findMany({
          where: { status: 'PROCESSING', leaseExpiresAt: { lt: new Date() } },
          take: 20,
        });
        for (const previous of jobs) {
          const job = await tx.textFontBuildJob.update({
            where: { id: previous.id },
            data: {
              status: 'QUEUED',
              attempt: { increment: 1 },
              claimToken: null,
              leaseExpiresAt: null,
            },
          });
          await this.outbox.enqueue(tx, {
            eventType: DOMAIN_EVENTS.TEXT_FONT_BUILD_REQUESTED,
            aggregateType: 'text-font',
            aggregateId: job.id,
            eventKey: `text-font-build:${job.id}:${job.attempt}`,
            payload: { jobId: job.id, attempt: job.attempt },
          });
        }
      });
    } catch {
      /* 后台恢复下次重试，不向调度器泄露数据库/连接异常。 */
    } finally {
      this.recovering = false;
    }
  }
}
