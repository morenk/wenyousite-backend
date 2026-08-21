import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import sharp from 'sharp';
import { withMediaVariants } from './media-response.mapper';
import { MediaReferenceService } from './media-reference.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

/** 允许的文件类型白名单 */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];

/** 单文件最大 10MB */
const MAX_SIZE = 10 * 1024 * 1024;

/** 孤儿图片清理：失败记录创建超过该天数且无引用才清理 */
const ORPHAN_GRACE_DAYS = 7;
/** 僵尸上传清理：UPLOADING 创建超过该小时数且未确认则清理 */
const UPLOADING_STALE_HOURS = 24;
/** 单次 S3 批量删除对象上限 */
const S3_BATCH_DELETE_LIMIT = 1000;
/** S3 兼容存储不支持无 Content-MD5 的 DeleteObjects，单对象删除限制并发数。 */
const S3_DELETE_CONCURRENCY = 20;

/** 图片处理任务类型 */
export interface ImageProcessJob {
  mediaId: string;
  objectKey: string;
  bucket: string;
}

/** 允许的文件扩展名（与 MIME 白名单对应） */
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);

/** 衍生图 Cache-Control：一年强缓存 */
const DERIVATIVE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** 媒体服务：S3 预签名上传 URL 生成、上传确认、图片处理、孤儿回收 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  s3: S3Client;
  /** 每用户小时上传配额 */
  private readonly uploadRatePerHour: number;
  private readonly completedOrphanCleanupEnabled: boolean;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private redis: RedisService,
    private mediaReferences: MediaReferenceService,
    @InjectQueue('image') private imageQueue: Queue,
  ) {
    this.uploadRatePerHour = this.config.get<number>('upload.ratePerHour') ?? 60;
    this.completedOrphanCleanupEnabled =
      this.config.get<boolean>('upload.completedOrphanCleanupEnabled') ?? false;
    this.s3 = new S3Client({
      endpoint: this.config.get<string>('cos.endpoint'),
      region: this.config.get<string>('cos.region') ?? 'auto',
      credentials: {
        accessKeyId: this.config.get<string>('cos.accessKeyId')!,
        secretAccessKey: this.config.get<string>('cos.secretAccessKey')!,
      },
      forcePathStyle: true,
    });
  }

  /** 生成 S3 预签名上传 URL，预建 Media 记录（UPLOADING），一次性返回 mediaId */
  async getUploadUrl(opts: {
    filename: string;
    contentType: string;
    size: number;
    userId: string;
  }) {
    if (!ALLOWED_MIME.includes(opts.contentType)) {
      throw new BadRequestException('不支持的文件类型');
    }
    if (opts.size > MAX_SIZE) {
      throw new BadRequestException('文件大小超过 10MB 限制');
    }

    await this.assertUploadRate(opts.userId);

    const ext = this.sanitizeExt(opts.filename);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const randomId = randomBytes(8).toString('hex');
    const objectKey = `uploads/${date}/${opts.userId}/${Date.now()}-${randomId}.${ext}`;

    const bucket = this.config.get<string>('cos.bucket')!;
    const publicUrl = this.buildPublicUrl(objectKey);

    const media = await this.prisma.media.create({
      data: {
        userId: opts.userId,
        url: publicUrl,
        key: objectKey,
        contentType: opts.contentType,
        size: opts.size,
      },
    });

    const uploadUrl = await this.signUploadUrl({
      bucket,
      key: objectKey,
      contentType: opts.contentType,
      size: opts.size,
    });

    return {
      uploadUrl,
      mediaId: media.id,
      objectKey,
      publicUrl,
    };
  }

  /** 为同一 UPLOADING 媒体重新签发 PUT 地址，不创建新记录也不重复占用上传配额。 */
  async reissueUploadUrl(mediaId: string, userId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('媒体记录不存在');
    if (media.userId !== userId) throw new ForbiddenException('无权操作');
    if (media.status !== 'UPLOADING' || !media.contentType || !media.size) {
      throw new BadRequestException('当前媒体状态不能重新上传');
    }
    const bucket = this.config.get<string>('cos.bucket')!;
    return {
      uploadUrl: await this.signUploadUrl({
        bucket,
        key: media.key,
        contentType: media.contentType,
        size: media.size,
      }),
      mediaId: media.id,
      objectKey: media.key,
      publicUrl: media.url,
    };
  }

  /** 客户端上传完成确认：核对对象元数据，幂等转 UPLOADING → PROCESSING 并入队 */
  async confirmUpload(mediaId: string, userId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('媒体记录不存在');
    }
    if (media.userId !== userId) {
      throw new ForbiddenException('无权操作');
    }
    if (media.status === 'PROCESSING' || media.status === 'COMPLETED') {
      return { media: withMediaVariants(media), processing: media.status === 'PROCESSING' };
    }
    if (media.status !== 'UPLOADING') {
      throw new BadRequestException('无效的上传状态');
    }

    const bucket = this.config.get<string>('cos.bucket')!;
    let head;

    try {
      head = await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: media.key }));
    } catch (error) {
      const storageError = error as {
        name?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const missing =
        storageError.$metadata?.httpStatusCode === HttpStatus.NOT_FOUND ||
        storageError.name === 'NotFound' ||
        storageError.name === 'NoSuchKey' ||
        storageError.Code === 'NoSuchKey';
      if (missing) {
        throw new BusinessException(
          ErrorCode.MEDIA_OBJECT_MISSING,
          '文件不存在或上传未完成',
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }

    const actualSize = head.ContentLength;
    const actualContentType = this.normalizeContentType(head.ContentType);
    const metadataInvalid =
      !Number.isSafeInteger(actualSize) ||
      actualSize! <= 0 ||
      actualSize! > MAX_SIZE ||
      !actualContentType ||
      !ALLOWED_MIME.includes(actualContentType) ||
      (media.size !== null && media.size !== actualSize) ||
      (media.contentType !== null && media.contentType !== actualContentType);

    if (metadataInvalid) {
      await this.prisma.media.updateMany({
        where: { id: mediaId, status: 'UPLOADING' },
        data: { status: 'FAILED' },
      });
      throw new BadRequestException('上传文件元数据与凭证不一致');
    }

    let processing;
    try {
      // 条件更新取得唯一入队权，避免两个确认请求各自创建任务。
      processing = await this.prisma.media.update({
        where: { id: mediaId, status: 'UPLOADING' },
        data: {
          status: 'PROCESSING',
          size: actualSize!,
          contentType: actualContentType!,
        },
      });
    } catch (error: any) {
      if (error?.code !== 'P2025') throw error;
      const current = await this.prisma.media.findUnique({ where: { id: mediaId } });
      if (
        current?.userId === userId &&
        (current.status === 'PROCESSING' || current.status === 'COMPLETED')
      ) {
        return { media: withMediaVariants(current), processing: current.status === 'PROCESSING' };
      }
      throw new BadRequestException('无效的上传状态');
    }

    try {
      await this.imageQueue.add(
        'process',
        {
          mediaId: media.id,
          objectKey: media.key,
          bucket,
        } as ImageProcessJob,
        {
          jobId: media.id,
          attempts: 2,
          backoff: { type: 'fixed', delay: 10000 },
          removeOnComplete: { age: 3600 * 24 },
          removeOnFail: { age: 3600 * 24 * 7 },
        },
      );
    } catch (error) {
      // 仅回滚仍在等待队列处理的记录；若消费者已完成则不得倒退状态。
      await this.prisma.media.updateMany({
        where: { id: mediaId, status: 'PROCESSING' },
        data: { status: 'UPLOADING' },
      });
      throw error;
    }

    return { media: withMediaVariants(processing), processing: true };
  }

  /** 根据 ID 查询单条媒体记录，校验所属用户 */
  async getMedia(id: string, userId: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) {
      throw new NotFoundException('媒体记录不存在');
    }
    if (media.userId !== userId) {
      throw new ForbiddenException('无权访问');
    }
    return withMediaVariants(media);
  }

  /** 生成缩略图和中图，上传至 S3 并更新 Media 记录 */
  async processImage(job: ImageProcessJob) {
    const { bucket, objectKey, mediaId } = job;

    const response = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    const chunks: Uint8Array[] = [];
    if (response.Body) {
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
    }
    const buffer = Buffer.concat(chunks);

    const metadata = await sharp(buffer).metadata();

    const thumbBuffer = await sharp(buffer)
      .resize(300, 300, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const thumbKey = objectKey.replace(/(\.[^.]+)$/, '_thumb.webp');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: 'image/webp',
        CacheControl: DERIVATIVE_CACHE_CONTROL,
      }),
    );

    const feedBuffer = await sharp(buffer)
      .resize(480, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const feedKey = objectKey.replace(/(\.[^.]+)$/, '_feed.webp');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: feedKey,
        Body: feedBuffer,
        ContentType: 'image/webp',
        CacheControl: DERIVATIVE_CACHE_CONTROL,
      }),
    );

    const mdBuffer = await sharp(buffer)
      .resize(800, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const mdKey = objectKey.replace(/(\.[^.]+)$/, '_md.webp');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: mdKey,
        Body: mdBuffer,
        ContentType: 'image/webp',
        CacheControl: DERIVATIVE_CACHE_CONTROL,
      }),
    );

    await this.prisma.media.updateMany({
      where: { id: mediaId, status: 'PROCESSING' },
      data: {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        size: buffer.length,
        status: 'COMPLETED',
        orphanedAt: new Date(),
      },
    });

    this.logger.log(
      `Image processed: ${objectKey} → thumb + feed + md, ${metadata.width}x${metadata.height}`,
    );
  }

  /** 标记图片处理失败（由 ImageProcessor 在末次重试时调用） */
  async markFailed(mediaId: string) {
    await this.prisma.media.updateMany({
      where: { id: mediaId, status: 'PROCESSING' },
      data: { status: 'FAILED' },
    });
    this.logger.warn(`Image processing permanently failed for mediaId=${mediaId}`);
  }

  /** 每用户小时上传配额校验：Redis 计数器，超限抛 429 */
  private async assertUploadRate(userId: string) {
    const hourEpoch = Math.floor(Date.now() / 3600000);
    const key = `media:uploads:hour:${userId}`;
    const count = await this.redis.hincrby(key, String(hourEpoch), 1);
    await this.redis.expire(key, 7200);
    if (count > this.uploadRatePerHour) {
      throw new HttpException('图片上传频率超限，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** 规范化对象存储返回的 MIME，忽略可选参数并统一小写。 */
  private normalizeContentType(contentType?: string) {
    return contentType?.split(';', 1)[0].trim().toLowerCase() || null;
  }

  /** 孤儿图片回收：引用标记对账后清理超出宽限期且无存活引用的对象（S3 + DB）。 */
  async cleanupOrphanMedia() {
    const reconciled = await this.mediaReferences.reconcileAllMarkers();
    if (reconciled > 0) this.logger.log(`媒体引用标记对账完成: 修复 ${reconciled} 条`);

    const now = Date.now();
    const uploadingCutoff = new Date(now - UPLOADING_STALE_HOURS * 3600000);
    const orphanCutoff = new Date(now - ORPHAN_GRACE_DAYS * 24 * 3600000);
    const completedCandidate = this.completedOrphanCleanupEnabled
      ? [{ status: 'COMPLETED' as const, orphanedAt: { lt: orphanCutoff } }]
      : [];
    const stale = await this.prisma.media.findMany({
      where: {
        OR: [
          { status: 'UPLOADING', createdAt: { lt: uploadingCutoff } },
          { status: 'FAILED', createdAt: { lt: orphanCutoff } },
          ...completedCandidate,
        ],
        stickerImports: { none: { status: 'PROCESSING' } },
      },
      select: { id: true, key: true, status: true },
    });

    const unreferencedIds = new Set(
      await this.mediaReferences.filterUnreferenced(stale.map((item) => item.id)),
    );
    const victims = stale.filter((item) => unreferencedIds.has(item.id));
    if (victims.length === 0) return;

    // 删除 S3 对象前已再次按数据库关系核验；原图删除失败的记录保留待下次重试。
    const bucket = this.config.get<string>('cos.bucket')!;
    const deletedIds = new Set<string>();
    for (let i = 0; i < victims.length; i += S3_BATCH_DELETE_LIMIT) {
      const chunk = victims.slice(i, i + S3_BATCH_DELETE_LIMIT);
      const keys: { key: string; mediaId: string; isOriginal: boolean }[] = [];
      for (const m of chunk) {
        keys.push({ key: m.key, mediaId: m.id, isOriginal: true });
        if (!m.key.toLowerCase().endsWith('.svg')) {
          const stem = m.key.replace(/\.[^.]+$/, '');
          keys.push({ key: `${stem}_thumb.webp`, mediaId: m.id, isOriginal: false });
          keys.push({ key: `${stem}_feed.webp`, mediaId: m.id, isOriginal: false });
          keys.push({ key: `${stem}_md.webp`, mediaId: m.id, isOriginal: false });
        }
      }
      const failedKeys = await this.deleteS3Objects(
        bucket,
        keys.map((k) => k.key),
      );
      for (const k of keys) {
        if (k.isOriginal && !failedKeys.has(k.key)) {
          deletedIds.add(k.mediaId);
        }
      }
    }

    // 只删除已成功移除原图且仍无引用的 DB 记录，防止清理期间新绑定产生竞态。
    if (deletedIds.size > 0) {
      const stillUnreferenced = await this.mediaReferences.filterUnreferenced([...deletedIds]);
      if (stillUnreferenced.length > 0) {
        await this.prisma.media.deleteMany({ where: { id: { in: stillUnreferenced } } });
      }
    }
    this.logger.log(`孤儿图片清理完成: 扫描 ${stale.length} 条候选，清理 ${deletedIds.size} 条`);
  }

  /** 单 URL 保守回收入口；COMPLETED 统一交由带宽限期的每日任务处理。 */
  async cleanupOrphanByUrl(url: string): Promise<boolean> {
    const media = await this.prisma.media.findFirst({
      where: { url },
      select: { id: true, key: true, status: true },
    });
    if (!media) return false;
    if (media.status === 'COMPLETED') return false;
    if ((await this.mediaReferences.filterUnreferenced([media.id])).length === 0) return false;

    const keys = [media.key];
    if (!media.key.toLowerCase().endsWith('.svg')) {
      const stem = media.key.replace(/\.[^.]+$/, '');
      keys.push(`${stem}_thumb.webp`, `${stem}_feed.webp`, `${stem}_md.webp`);
    }
    const failedKeys = await this.deleteS3Objects(this.config.get<string>('cos.bucket')!, keys);
    if (failedKeys.has(media.key)) return false;

    await this.prisma.media.deleteMany({ where: { id: media.id } });
    this.logger.log(`注销头像已回收 mediaId=${media.id}`);
    return true;
  }

  /** 有限并发删除 S3 对象，返回删除失败的 key 集合 */
  private async deleteS3Objects(bucket: string, keys: string[]): Promise<Set<string>> {
    const failed = new Set<string>();
    for (let i = 0; i < keys.length; i += S3_DELETE_CONCURRENCY) {
      const chunk = keys.slice(i, i + S3_DELETE_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((Key) => this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }))),
      );
      for (let index = 0; index < results.length; index++) {
        if (results[index].status === 'rejected') {
          failed.add(chunk[index]);
        }
      }
      if (results.some((result) => result.status === 'rejected')) {
        this.logger.error(`删除 S3 对象失败: ${failed.size} 个待重试`);
      }
    }
    return failed;
  }

  private signUploadUrl(input: { bucket: string; key: string; contentType: string; size: number }) {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.size,
      }),
      { expiresIn: 600 },
    );
  }

  /** 构建文件公网访问 URL */
  private buildPublicUrl(objectKey: string): string {
    const endpoint = this.config.get<string>('cos.endpoint');
    const bucket = this.config.get<string>('cos.bucket')!;
    const baseUrl = endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucket}`
      : `https://${bucket}.s3.${this.config.get<string>('cos.region')}.amazonaws.com`;
    return `${baseUrl}/${objectKey}`;
  }

  /** 文件名消毒：提取最后一段扩展名，仅允许图片扩展名，防止双重扩展名攻击 */
  private sanitizeExt(filename: string): string {
    const parts = filename.split('.');
    const ext =
      parts
        .pop()
        ?.replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase() || 'bin';
    if (!ext || ext.length > 10 || !ALLOWED_EXTENSIONS.has(ext)) {
      return 'bin';
    }
    return ext;
  }
}
