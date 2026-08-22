import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StickersService } from './stickers.service';

const RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
const PROCESSING_STALE_MS = 15 * 60 * 1000;
const RECOVERY_BATCH_SIZE = 100;

/** 修复 Redis 丢失任务或异常终止造成的长期 PROCESSING 表情导入。 */
@Injectable()
export class StickerProcessingRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(StickerProcessingRecoveryService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stickers: StickersService,
    @InjectQueue('sticker') private readonly queue: Queue,
  ) {}

  onModuleInit() {
    void this.reconcile().catch((error: unknown) => {
      const errorCode =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'recovery_failed';
      this.logger.error(`Initial sticker recovery failed errorCode=${errorCode}`);
    });
  }

  @Interval(RECOVERY_INTERVAL_MS)
  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      const stale = await this.prisma.stickerImport.findMany({
        where: {
          status: 'PROCESSING',
          updatedAt: { lt: new Date(Date.now() - PROCESSING_STALE_MS) },
        },
        orderBy: { updatedAt: 'asc' },
        take: RECOVERY_BATCH_SIZE,
        select: { id: true },
      });

      for (const item of stale) await this.reconcileOne(item.id);
    } finally {
      this.running = false;
    }
  }

  private async reconcileOne(importId: string) {
    const job = await this.queue.getJob(importId);
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
      await this.stickers.markImportFailed(importId, new Error('队列任务已终止失败'));
      return;
    }
    if (state === 'completed') await job!.remove();
    if (state !== 'missing' && state !== 'completed') {
      this.logger.warn(`Sticker recovery skipped importId=${importId} queueState=${state}`);
      return;
    }

    await this.stickers.enqueueImport(importId);
    await this.prisma.stickerImport.updateMany({
      where: { id: importId, status: 'PROCESSING' },
      data: { updatedAt: new Date() },
    });
    this.logger.warn(
      `Sticker processing job recovered importId=${importId} previousState=${state}`,
    );
  }
}
