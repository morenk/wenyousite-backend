import {
  Injectable, BadRequestException, NotFoundException, Logger,
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

/** 图片处理类型 */
export interface ImageProcessJob {
  mediaId: string;
  objectKey: string;
  bucket: string;
}

/** 允许的文件扩展名（与 MIME 白名单对应） */
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg']);

/** 媒体服务：S3 预签名上传 URL 生成、上传确认、图片处理入队 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  s3: S3Client; // 公开属性，允许测试注入

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

  /** 生成 S3 预签名上传 URL，客户端凭此直传文件到对象存储 */
  async getUploadUrl(opts: { filename: string; contentType: string; size: number; userId: string }) {
    if (!ALLOWED_MIME.includes(opts.contentType)) {
      throw new BadRequestException('不支持的文件类型');
    }
    if (opts.size > MAX_SIZE) {
      throw new BadRequestException('文件大小超过 10MB 限制');
    }

    // 文件名消毒：仅保留安全扩展名，目录隔离防止路径遍历
    const ext = this.sanitizeExt(opts.filename);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const randomId = Math.random().toString(36).slice(2, 8);
    const objectKey = `uploads/${date}/${opts.userId}/${Date.now()}-${randomId}.${ext}`;

    const bucket = this.config.get<string>('cos.bucket')!;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: opts.contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 600 });

    return {
      uploadUrl,
      objectKey,
      publicUrl: this.buildPublicUrl(objectKey),
    };
  }

  /** 客户端上传完成确认：写入 Media 记录，入队异步图片处理 */
  async confirmUpload(objectKey: string, userId: string) {
    const bucket = this.config.get<string>('cos.bucket')!;
    const publicUrl = this.buildPublicUrl(objectKey);

    // 检查 S3 对象是否存在
    try {
      await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    } catch {
      throw new NotFoundException('文件不存在或上传未完成');
    }

    // 写入 Media 追踪记录
    const media = await this.prisma.media.create({
      data: { userId, url: publicUrl, key: objectKey },
    });

    // 跳过 SVG（矢量图无需压缩缩放）
    if (objectKey.toLowerCase().endsWith('.svg')) {
      return { media, processing: false };
    }

    // 入队异步图片处理：生成缩略图和中图
    await this.imageQueue.add('process', {
      mediaId: media.id,
      objectKey,
      bucket,
    } as ImageProcessJob, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 24 * 7 },
    });

    return { media, processing: true };
  }

  /** 生成缩略图和中图，上传至 S3 并更新 Media 记录 */
  async processImage(job: ImageProcessJob) {
    const bucket = job.bucket;
    const objectKey = job.objectKey;

    // 从 S3 下载原图到内存
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

    // 获取原始尺寸
    const metadata = await sharp(buffer).metadata();

    // 生成缩略图 300x300，webp 格式减小体积
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
    }));

    // 生成中图 800px 等比缩放，webp 格式
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
    }));

    // 更新 Media 记录：写入尺寸和缩略图 URL
    await this.prisma.media.update({
      where: { id: job.mediaId },
      data: {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        size: buffer.length,
      },
    });

    this.logger.log(`Image processed: ${objectKey} → thumb + md, ${metadata.width}x${metadata.height}`);
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
    // 只有最后一段是扩展名
    const ext = parts.pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
    if (!ext || ext.length > 10 || !ALLOWED_EXTENSIONS.has(ext)) {
      return 'bin';
    }
    return ext;
  }
}
