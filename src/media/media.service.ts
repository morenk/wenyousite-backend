import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';
import sharp from 'sharp';

/** 允许的文件类型白名单 */
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/avif', 'image/svg+xml',
];

/** 单文件最大 10MB */
const MAX_SIZE = 10 * 1024 * 1024;

/** 图片处理任务类型 */
export interface ImageProcessJob {
  mediaId: string;
  objectKey: string;
  bucket: string;
}

/** 允许的文件扩展名（与 MIME 白名单对应） */
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg']);

/** 衍生图 Cache-Control：一年强缓存 */
const DERIVATIVE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** 媒体服务：S3 预签名上传 URL 生成、上传确认、图片处理 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  s3: S3Client;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @InjectQueue('image') private imageQueue: Queue,
  ) {
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
  async getUploadUrl(opts: { filename: string; contentType: string; size: number; userId: string }) {
    if (!ALLOWED_MIME.includes(opts.contentType)) {
      throw new BadRequestException('不支持的文件类型');
    }
    if (opts.size > MAX_SIZE) {
      throw new BadRequestException('文件大小超过 10MB 限制');
    }

    const ext = this.sanitizeExt(opts.filename);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const randomId = Math.random().toString(36).slice(2, 8);
    const objectKey = `uploads/${date}/${opts.userId}/${Date.now()}-${randomId}.${ext}`;

    const bucket = this.config.get<string>('cos.bucket')!;
    const publicUrl = this.buildPublicUrl(objectKey);

    const media = await this.prisma.media.create({
      data: { userId: opts.userId, url: publicUrl, key: objectKey },
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: opts.contentType,
      ContentLength: opts.size,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 600 });

    return {
      uploadUrl,
      mediaId: media.id,
      objectKey,
      publicUrl,
    };
  }

  /** 客户端上传完成确认：校验归属，转 UPLOADING → PROCESSING 并入队 */
  async confirmUpload(mediaId: string, userId: string) {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('媒体记录不存在');
    }
    if (media.userId !== userId) {
      throw new ForbiddenException('无权操作');
    }
    if (media.status !== 'UPLOADING') {
      throw new BadRequestException('无效的上传状态');
    }

    const bucket = this.config.get<string>('cos.bucket')!;

    try {
      await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: media.key }));
    } catch {
      throw new NotFoundException('文件不存在或上传未完成');
    }

    // SVG 矢量图无需缩放加工，直接标记完成
    if (media.key.toLowerCase().endsWith('.svg')) {
      const completed = await this.prisma.media.update({
        where: { id: mediaId },
        data: { status: 'COMPLETED' },
      });
      return { media: completed, processing: false };
    }

    await this.imageQueue.add('process', {
      mediaId: media.id,
      objectKey: media.key,
      bucket,
    } as ImageProcessJob, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 24 * 7 },
    });

    const processing = await this.prisma.media.update({
      where: { id: mediaId },
      data: { status: 'PROCESSING' },
    });

    return { media: processing, processing: true };
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
    return media;
  }

  /** 生成缩略图和中图，上传至 S3 并更新 Media 记录 */
  async processImage(job: ImageProcessJob) {
    const { bucket, objectKey, mediaId } = job;

    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
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
    await this.s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: thumbKey,
      Body: thumbBuffer,
      ContentType: 'image/webp',
      CacheControl: DERIVATIVE_CACHE_CONTROL,
    }));

    const mdBuffer = await sharp(buffer)
      .resize(800, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const mdKey = objectKey.replace(/(\.[^.]+)$/, '_md.webp');
    await this.s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: mdKey,
      Body: mdBuffer,
      ContentType: 'image/webp',
      CacheControl: DERIVATIVE_CACHE_CONTROL,
    }));

    await this.prisma.media.update({
      where: { id: mediaId },
      data: {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        size: buffer.length,
        status: 'COMPLETED',
      },
    });

    this.logger.log(`Image processed: ${objectKey} → thumb + md, ${metadata.width}x${metadata.height}`);
  }

  /** 标记图片处理失败（由 ImageProcessor 在末次重试时调用） */
  async markFailed(mediaId: string) {
    await this.prisma.media.update({
      where: { id: mediaId },
      data: { status: 'FAILED' },
    });
    this.logger.warn(`Image processing permanently failed for mediaId=${mediaId}`);
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
    const ext = parts.pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
    if (!ext || ext.length > 10 || !ALLOWED_EXTENSIONS.has(ext)) {
      return 'bin';
    }
    return ext;
  }
}
