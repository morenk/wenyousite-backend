import { Injectable, Logger } from '@nestjs/common';
import { MediaPurpose } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import sharp, { Metadata } from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { derivativeKey, mediaVariantsFor, MediaVariantName } from './media-policy';

const MAX_STATIC_INPUT_PIXELS = 64_000_000;
const MAX_GIF_EDGE = 2560;
const MAX_GIF_FRAMES = 300;
const MAX_GIF_DURATION_MS = 60_000;
const MAX_GIF_TOTAL_PIXELS = 100_000_000;
const MASTER_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const DERIVATIVE_CACHE_CONTROL = MASTER_CACHE_CONTROL;

type StageTimings = Record<
  'downloadMs' | 'inspectMs' | 'normalizeMs' | 'variantsMs' | 'uploadMs' | 'databaseMs' | 'cleanupMs',
  number
>;

type ProcessOptions = { queueWaitMs?: number };

type VariantOutput = {
  name: MediaVariantName;
  key: string;
  body: Buffer;
};

function elapsed(start: number) {
  return Math.round(performance.now() - start);
}

function detectedContentType(format?: string): string | null {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heif':
    case 'avif':
      return 'image/avif';
    default:
      return null;
  }
}

function assertDimensions(metadata: Metadata) {
  if (!metadata.width || !metadata.height) throw new Error('IMAGE_DIMENSIONS_MISSING');
  if (metadata.width * metadata.height > MAX_STATIC_INPUT_PIXELS) {
    throw new Error('IMAGE_PIXEL_LIMIT_EXCEEDED');
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  transform: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await transform(values[index]);
      }
    }),
  );
  return results;
}

@Injectable()
export class MediaProcessingService {
  private readonly logger = new Logger(MediaProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  async processImage(mediaId: string, options: ProcessOptions = {}) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media || media.status !== 'PROCESSING') return;

    if (!media.stagingKey) {
      await this.processLegacyObject(mediaId, media.key);
      return;
    }

    const timings: StageTimings = {
      downloadMs: 0,
      inspectMs: 0,
      normalizeMs: 0,
      variantsMs: 0,
      uploadMs: 0,
      databaseMs: 0,
      cleanupMs: 0,
    };
    let started = performance.now();
    const source = await this.storage.download(media.stagingKey);
    timings.downloadMs = elapsed(started);

    started = performance.now();
    const metadata = await sharp(source, {
      animated: true,
      limitInputPixels: MAX_STATIC_INPUT_PIXELS,
    }).metadata();
    assertDimensions(metadata);
    const detectedType = detectedContentType(metadata.format);
    if (!detectedType || detectedType !== media.contentType) throw new Error('IMAGE_TYPE_MISMATCH');
    const pages = metadata.pages ?? 1;
    const isGif = detectedType === 'image/gif';
    if (!isGif && pages > 1) throw new Error('ANIMATED_IMAGE_UNSUPPORTED');
    if (isGif) this.assertGif(metadata, pages);
    timings.inspectMs = elapsed(started);

    started = performance.now();
    const master = isGif ? source : await this.normalizeStatic(source);
    const masterInfo = isGif
      ? { width: metadata.width!, height: metadata.height!, size: source.length }
      : await sharp(master, { limitInputPixels: MAX_STATIC_INPUT_PIXELS }).metadata().then((value) => ({
          width: value.width!,
          height: value.height!,
          size: master.length,
        }));
    timings.normalizeMs = elapsed(started);

    const variants = mediaVariantsFor(media.purpose, isGif);
    started = performance.now();
    const outputs = await mapConcurrent(variants, 2, (variant) =>
      this.createVariant(master, media.key, variant),
    );
    timings.variantsMs = elapsed(started);

    started = performance.now();
    await Promise.all([
      this.storage.upload(media.key, master, {
        contentType: isGif ? 'image/gif' : 'image/webp',
        cacheControl: MASTER_CACHE_CONTROL,
      }),
      ...outputs.map((output) =>
        this.storage.upload(output.key, output.body, {
          contentType: 'image/webp',
          cacheControl: DERIVATIVE_CACHE_CONTROL,
        }),
      ),
    ]);
    timings.uploadMs = elapsed(started);

    started = performance.now();
    const completed = await this.prisma.media.updateMany({
      where: { id: mediaId, status: 'PROCESSING' },
      data: {
        contentType: isGif ? 'image/gif' : 'image/webp',
        size: masterInfo.size,
        width: masterInfo.width,
        height: masterInfo.height,
        animated: isGif,
        status: 'COMPLETED',
        processingStartedAt: null,
        orphanedAt: new Date(),
      },
    });
    timings.databaseMs = elapsed(started);
    if (completed.count !== 1) return;

    started = performance.now();
    await this.removeStagingObject(mediaId, media.stagingKey);
    timings.cleanupMs = elapsed(started);

    this.logger.log(
      [
        'media_processing_complete',
        `mediaId=${mediaId}`,
        `purpose=${media.purpose}`,
        `animated=${isGif}`,
        `sourceBytes=${source.length}`,
        `masterBytes=${master.length}`,
        `variants=${outputs.length}`,
        `queueWaitMs=${Math.max(0, Math.round(options.queueWaitMs ?? 0))}`,
        ...Object.entries(timings).map(([name, value]) => `${name}=${value}`),
      ].join(' '),
    );
  }

  async markFailed(mediaId: string) {
    const failed = await this.prisma.media.updateMany({
      where: { id: mediaId, status: 'PROCESSING' },
      data: { status: 'FAILED', processingStartedAt: null },
    });
    if (failed.count === 0) return;
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { stagingKey: true },
    });
    if (media?.stagingKey) await this.removeStagingObject(mediaId, media.stagingKey);
    this.logger.warn(`media_processing_failed mediaId=${mediaId}`);
  }

  async cleanupCompletedStagingObjects(limit = 100) {
    const rows = await this.prisma.media.findMany({
      where: { status: { in: ['COMPLETED', 'FAILED'] }, stagingKey: { not: null } },
      select: { id: true, stagingKey: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    let cleaned = 0;
    for (const row of rows) {
      if (row.stagingKey && (await this.removeStagingObject(row.id, row.stagingKey))) cleaned++;
    }
    return cleaned;
  }

  async discardStagingObject(mediaId: string, stagingKey: string) {
    await this.removeStagingObject(mediaId, stagingKey);
  }

  private async normalizeStatic(source: Buffer) {
    return sharp(source, { limitInputPixels: MAX_STATIC_INPUT_PIXELS })
      .rotate()
      .resize({
        width: 2560,
        height: 2560,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85, alphaQuality: 100, effort: 4 })
      .toBuffer();
  }

  private async createVariant(master: Buffer, key: string, variant: MediaVariantName) {
    const pipeline = sharp(master, { limitInputPixels: MAX_STATIC_INPUT_PIXELS });
    if (variant === 'thumbnail') {
      pipeline.resize(300, 300, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 80 });
    } else if (variant === 'feed') {
      pipeline.resize(480, null, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 });
    } else {
      pipeline.resize(800, null, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 });
    }
    return {
      name: variant,
      key: derivativeKey(key, variant),
      body: await pipeline.toBuffer(),
    } satisfies VariantOutput;
  }

  private assertGif(metadata: Metadata, pages: number) {
    const width = metadata.width!;
    const height = metadata.height!;
    const duration = (metadata.delay ?? []).reduce((sum, delay) => sum + delay, 0);
    if (Math.max(width, height) > MAX_GIF_EDGE) throw new Error('GIF_EDGE_LIMIT_EXCEEDED');
    if (pages > MAX_GIF_FRAMES) throw new Error('GIF_FRAME_LIMIT_EXCEEDED');
    if (duration > MAX_GIF_DURATION_MS) throw new Error('GIF_DURATION_LIMIT_EXCEEDED');
    if (width * height * pages > MAX_GIF_TOTAL_PIXELS) {
      throw new Error('GIF_TOTAL_PIXEL_LIMIT_EXCEEDED');
    }
  }

  private async removeStagingObject(mediaId: string, stagingKey: string) {
    try {
      await this.storage.remove(stagingKey);
      await this.prisma.media.updateMany({
        where: { id: mediaId, stagingKey },
        data: { stagingKey: null },
      });
      return true;
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : 'remove_failed';
      this.logger.warn(`media_staging_cleanup_deferred mediaId=${mediaId} errorCode=${code}`);
      return false;
    }
  }

  /** 迁移前已在原 key 上传的极少量任务保持旧行为，避免覆盖扩展名与历史 URL。 */
  private async processLegacyObject(mediaId: string, key: string) {
    const source = await this.storage.download(key);
    const metadata = await sharp(source, {
      animated: true,
      limitInputPixels: MAX_STATIC_INPUT_PIXELS,
    }).metadata();
    assertDimensions(metadata);
    const animated = metadata.format === 'gif';
    const pages = metadata.pages ?? 1;
    if (animated) this.assertGif(metadata, pages);
    else if (pages > 1) throw new Error('ANIMATED_IMAGE_UNSUPPORTED');
    const outputs = await mapConcurrent(
      mediaVariantsFor(MediaPurpose.LEGACY, animated),
      2,
      (variant) => this.createVariant(source, key, variant),
    );
    await Promise.all(
      outputs.map((output) =>
        this.storage.upload(output.key, output.body, {
          contentType: 'image/webp',
          cacheControl: DERIVATIVE_CACHE_CONTROL,
        }),
      ),
    );
    await this.prisma.media.updateMany({
      where: { id: mediaId, status: 'PROCESSING' },
      data: {
        width: metadata.width!,
        height: metadata.height!,
        animated,
        status: 'COMPLETED',
        processingStartedAt: null,
        orphanedAt: new Date(),
      },
    });
    this.logger.log(`media_processing_legacy_complete mediaId=${mediaId}`);
  }
}
