import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { StickerProcessJob, StickersService } from './stickers.service';

@Processor('sticker')
export class StickerProcessor extends WorkerHost {
  private readonly logger = new Logger(StickerProcessor.name);

  constructor(private readonly stickers: StickersService) {
    super();
  }

  async process(job: Job<StickerProcessJob>) {
    try {
      await this.stickers.processImport(job.data.importId);
    } catch (error) {
      this.logger.error(`Sticker processing failed importId=${job.data.importId}`, error);
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.stickers.markImportFailed(job.data.importId, error);
      }
      throw error;
    }
  }
}

