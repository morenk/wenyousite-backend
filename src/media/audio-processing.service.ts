import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MediaProcessingService } from './media-processing.service';
import { AudioRuntimeService } from './audio-runtime.service';
import { encodeAudio, AudioEncodingError } from './audio-encoder';
import { AUDIO_MAX_BYTES } from './audio-policy';

@Injectable()
export class AudioProcessingService {
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly images: MediaProcessingService,
    private readonly runtime: AudioRuntimeService,
  ) {}

  /** 复用独立 Worker 进程，音频本身串行，避免同时两个编解码子进程。 */
  async process(mediaId: string) {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
      if (
        !media ||
        media.deletionClaimedAt ||
        media.status !== 'PROCESSING' ||
        media.purpose !== 'RICH_CONTENT_AUDIO'
      )
        return;
      if (!media.stagingKey) throw new AudioEncodingError('AUDIO_INVALID');
      const runtime = this.runtime.requireReady();
      const source = await this.storage.download(
        media.stagingKey,
        this.storage.bucket,
        AUDIO_MAX_BYTES,
      );
      const result = await encodeAudio(source, media.contentType ?? '', runtime);
      await this.storage.upload(media.key, result.body, {
        contentType: 'audio/mpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      const completed = await this.prisma.media.updateMany({
        where: { id: media.id, status: 'PROCESSING', deletionClaimedAt: null },
        data: {
          status: 'COMPLETED',
          contentType: 'audio/mpeg',
          size: result.body.length,
          durationMs: result.durationMs,
          width: null,
          height: null,
          animated: false,
          failureCode: null,
          processingStartedAt: null,
          orphanedAt: new Date(),
        },
      });
      if (completed.count === 1) await this.images.discardStagingObject(media.id, media.stagingKey);
      // 若并发回收取得领取权，仍由已登记的正式 key 重试回收；不删除可能已完成的并发输出。
    } finally {
      release();
    }
  }
  async markFailed(mediaId: string, error?: unknown) {
    const failed = await this.prisma.media.updateMany({
      where: {
        id: mediaId,
        status: 'PROCESSING',
        purpose: 'RICH_CONTENT_AUDIO',
        deletionClaimedAt: null,
      },
      data: {
        status: 'FAILED',
        failureCode: error instanceof AudioEncodingError ? error.code : 'AUDIO_PROCESSING_FAILED',
        processingStartedAt: null,
      },
    });
    if (!failed.count) return;
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { stagingKey: true },
    });
    if (media?.stagingKey) await this.images.discardStagingObject(mediaId, media.stagingKey);
  }
}
