import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** 媒体服务：S3 预签名上传 URL 生成 */
@Injectable()
export class MediaService {
  private s3: S3Client;

  // 允许的文件类型白名单
  private readonly ALLOWED_MIME = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'image/avif', 'image/svg+xml',
  ];

  // 单文件最大 10MB
  private readonly MAX_SIZE = 10 * 1024 * 1024;

  constructor(private config: ConfigService) {
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

  /** 生成预签名上传 URL */
  async getUploadUrl(opts: { filename: string; contentType: string; size: number; userId: string }) {
    // 校验文件类型
    if (!this.ALLOWED_MIME.includes(opts.contentType)) {
      throw new BadRequestException('不支持的文件类型');
    }

    // 校验文件大小
    if (opts.size > this.MAX_SIZE) {
      throw new BadRequestException('文件大小超过 10MB 限制');
    }

    // 按日期 + 用户 ID 隔离存储路径
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const ext = opts.filename.split('.').pop() || 'bin';
    const objectKey = `uploads/${date}/${opts.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const bucket = this.config.get<string>('cos.bucket');

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: opts.contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: 600, // 10分钟有效
    });

    const endpoint = this.config.get<string>('cos.endpoint');
    const baseUrl = endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucket}`
      : `https://${bucket}.s3.${this.config.get<string>('cos.region')}.amazonaws.com`;

    return {
      uploadUrl,
      objectKey,
      publicUrl: `${baseUrl}/${objectKey}`,
    };
  }
}
