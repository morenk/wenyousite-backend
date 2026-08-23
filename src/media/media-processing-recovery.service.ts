import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from './media.service';

const RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
const PROCESSING_STALE_MS = 15 * 60 * 1000;
const RECOVERY_BATCH_SIZE = 100;

/** 修复 Redis 丢失任务或异常终止造成的长期 PROCESSING 媒体。 */
@Injectable()
export class MediaProcessingRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(MediaProcessingRecoveryService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    @InjectQueue('image') private readonly queue: Queue,
  ) {}

  onModuleInit() {
    void this.reconcile().catch((error: unknown) => {
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'recovery_failed';
      this.logger.error(`Initial media recovery failed errorCode=${errorCode}`);
    });
  }

  @Interval(RECOVERY_INTERVAL_MS)
  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - PROCESSING_STALE_MS);
      const stale = await this.prisma.media.findMany({
        where: {
          status: 'PROCESSING',
          OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: cutoff } }],
        },
        orderBy: { processingStartedAt: 'asc' },
        take: RECOVERY_BATCH_SIZE,
        select: { id: true },
      });

      for (const item of stale) await this.reconcileOne(item);
    } finally {
      this.running = false;
    }
  }

  private async reconcileOne(item: { id: string }) {
    const job = await this.queue.getJob(item.id);
    const state = job ? await job.getState() : 'missing';
    if (
      state === 'waiting' ||
      state === 'active' ||
      state === 'delayed' ||
      state === 'prioritized'
    ) {
      return;
    }
    if (state === 'failed') {
      await this.media.markFailed(item.id);
      return;
    }
    if (state === 'completed') await job!.remove();
    if (state !== 'missing' && state !== 'completed') {
      this.logger.warn(`Media recovery skipped mediaId=${item.id} queueState=${state}`);
      return;
    }

    await this.media.enqueueProcessing(item.id);
    await this.prisma.media.updateMany({
      where: { id: item.id, status: 'PROCESSING' },
      data: { processingStartedAt: new Date() },
    });
    this.logger.warn(`Media processing job recovered mediaId=${item.id} previousState=${state}`);
  }
}
