import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DELETE_CONCURRENCY = 20;

export interface ObjectUploadOptions {
  bucket?: string;
  contentType?: string;
  cacheControl?: string;
  contentLength?: number;
}

/** S3 兼容对象存储的唯一基础设施适配器。 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('cos.bucket')!;
    this.client = new S3Client({
      endpoint: this.config.get<string>('cos.endpoint'),
      region: this.config.get<string>('cos.region') ?? 'auto',
      credentials: {
        accessKeyId: this.config.get<string>('cos.accessKeyId')!,
        secretAccessKey: this.config.get<string>('cos.secretAccessKey')!,
      },
      forcePathStyle: true,
    });
  }

  head(key: string, bucket = this.bucket) {
    return this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  }

  async download(key: string, bucket = this.bucket) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    if (response.Body) {
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async upload(key: string, body: Buffer, options: ObjectUploadOptions = {}) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: options.bucket ?? this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        CacheControl: options.cacheControl,
        ContentLength: options.contentLength,
      }),
    );
  }

  async remove(key: string, bucket = this.bucket) {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /** 有限并发删除对象，返回失败 key，便于调用方保留事实记录并重试。 */
  async removeMany(keys: string[], bucket = this.bucket): Promise<Set<string>> {
    const failed = new Set<string>();
    for (let i = 0; i < keys.length; i += DELETE_CONCURRENCY) {
      const chunk = keys.slice(i, i + DELETE_CONCURRENCY);
      const results = await Promise.allSettled(chunk.map((key) => this.remove(key, bucket)));
      for (let index = 0; index < results.length; index++) {
        if (results[index].status === 'rejected') failed.add(chunk[index]);
      }
    }
    if (failed.size > 0) this.logger.error(`删除对象存储文件失败: ${failed.size} 个待重试`);
    return failed;
  }

  signUploadUrl(input: {
    key: string;
    contentType: string;
    size: number;
    bucket?: string;
    expiresIn?: number;
  }) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: input.bucket ?? this.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.size,
      }),
      { expiresIn: input.expiresIn ?? 600 },
    );
  }

  publicUrl(key: string, bucket = this.bucket): string {
    const endpoint = this.config.get<string>('cos.endpoint');
    const baseUrl = endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucket}`
      : `https://${bucket}.s3.${this.config.get<string>('cos.region')}.amazonaws.com`;
    return `${baseUrl}/${key}`;
  }
}
