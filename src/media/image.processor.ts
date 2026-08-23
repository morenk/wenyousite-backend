import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImageProcessJob } from './media.service';
import { MediaProcessingService } from './media-processing.service';

/** 图片处理队列消费者：从 S3 下载原图，用 sharp 生成缩略图、信息流图和中图，上传回 S3 */
@Processor('image', { concurrency: 2 })
export class ImageProcessor extends WorkerHost {
  private readonly logger = new Logger(ImageProcessor.name);

  constructor(private mediaProcessing: MediaProcessingService) {
    super();
  }

  async process(job: Job<ImageProcessJob>): Promise<void> {
    try {
      await this.mediaProcessing.processImage(job.data.mediaId, {
        queueWaitMs: Date.now() - job.timestamp,
      });
    } catch (e) {
      this.logger.error(`Image processing failed for mediaId=${job.data.mediaId}`, e);
      // 末次重试仍失败则标记为 FAILED，让前端能展示错误状态
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.mediaProcessing.markFailed(job.data.mediaId);
      }
      throw e;
    }
  }
}
