import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** 表情对象存储封装，所有对象均以内容哈希作为不可变 key。 */
@Injectable()
export class StickerStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

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

  async download(key: string) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    if (response.Body) {
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async upload(key: string, body: Buffer) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }));
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string) {
    const endpoint = this.config.get<string>('cos.endpoint');
    const baseUrl = endpoint
      ? `${endpoint.replace(/\/$/, '')}/${this.bucket}`
      : `https://${this.bucket}.s3.${this.config.get<string>('cos.region')}.amazonaws.com`;
    return `${baseUrl}/${key}`;
  }
}
