import { AudioProcessingService } from './audio-processing.service';
import { PrismaService } from '../prisma/prisma.service';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImageProcessJob } from './media.service';
import { MediaProcessingService } from './media-processing.service';

/** 图片处理队列消费者：从 S3 下载原图，用 sharp 生成缩略图、信息流图和中图，上传回 S3 */
@Processor('image', { concurrency: 2 })
export class ImageProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(
    private mediaProcessing: MediaProcessingService,
    private readonly audio?: AudioProcessingService,
    private readonly prisma?: PrismaService,
  ) {
    super();
  }

  async process(job: Job<ImageProcessJob>): Promise<void> {
    const media = this.prisma
      ? await this.prisma.media.findUnique({
          where: { id: job.data.mediaId },
          select: { purpose: true },
        })
      : null;
    const isAudio = media?.purpose === 'RICH_CONTENT_AUDIO';
    try {
      if (isAudio) {
        await this.audio!.process(job.data.mediaId);
        return;
      }
      if (job.name === 'display-backfill') {
        await this.mediaProcessing.processDisplay(job.data.mediaId);
        return;
      }
      await this.mediaProcessing.processImage(job.data.mediaId, {
        queueWaitMs: Date.now() - job.timestamp,
      });
    } catch (e) {
      this.logger.error(`Media processing failed for mediaId=${job.data.mediaId}`);
      // 末次重试仍失败则标记为 FAILED，让前端能展示错误状态
      if (job.name !== 'display-backfill' && job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        if (isAudio) await this.audio!.markFailed(job.data.mediaId, e);
        else await this.mediaProcessing.markFailed(job.data.mediaId);
      }
      throw e;
    }
  }
}
