import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable, Transform } from 'node:stream';
import { z } from 'zod';
import { Artifact, artifactSchema, assertDownload, fileName } from './download-model';
import { APK_MEDIA_TYPE } from './app-download.contract';
import { loadEnvironmentFile } from './download-config';

const originSchema = z
  .object({
    DOWNLOAD_S3_ENDPOINT: z.literal('https://cn-nb1.rains3.com'),
    DOWNLOAD_S3_REGION: z.literal('cn-nb1'),
    DOWNLOAD_S3_ACCESS_KEY_ID: z.string().min(1),
    DOWNLOAD_S3_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .strict();
export interface OriginReader {
  head(artifact: Artifact, signal: AbortSignal): Promise<void>;
  get(artifact: Artifact, signal: AbortSignal): Promise<Readable>;
  close(): void;
}
/** 与图片 Buffer 适配器隔离；只有发布 CLI 可构造，SDK 自动重试关闭。 */
export class StreamingApkOrigin implements OriginReader {
  constructor(private readonly client: S3Client) {
    const handler = client.config.requestHandler,
      original = handler.handle.bind(handler);
    handler.handle = async (request, options) => {
      const result = await original(request, options);
      if (result.response.statusCode >= 300 && result.response.body instanceof Readable) {
        const body = result.response.body;
        let seen = 0;
        const bounded = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            seen += chunk.length;
            callback(
              seen > 65536 ? new Error('ORIGIN_ERROR_TOO_LARGE') : null,
              seen > 65536 ? undefined : chunk,
            );
          },
        });
        body.once('error', (error: Error) => bounded.destroy(error));
        bounded.once('close', () => body.destroy());
        result.response.body = body.pipe(bounded);
      }
      return result;
    };
  }
  static async fromEnvironment(path: string) {
    const env = originSchema.parse(await loadEnvironmentFile(path));
    return new StreamingApkOrigin(
      new S3Client({
        endpoint: env.DOWNLOAD_S3_ENDPOINT,
        region: env.DOWNLOAD_S3_REGION,
        credentials: {
          accessKeyId: env.DOWNLOAD_S3_ACCESS_KEY_ID,
          secretAccessKey: env.DOWNLOAD_S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
        maxAttempts: 1,
        followRegionRedirects: false,
        requestHandler: { connectionTimeout: 5000, requestTimeout: 30_000 },
      }),
    );
  }
  private validate(
    a: Artifact,
    metadata: Record<string, string> | undefined,
    size: number | undefined,
    contentType: string | undefined,
    disposition: string | undefined,
  ) {
    assertDownload(
      size === a.sizeBytes &&
        contentType === APK_MEDIA_TYPE &&
        disposition === `attachment; filename="${fileName(a)}"`,
    );
    assertDownload(
      metadata?.['apk-sha256'] === a.sha256 &&
        metadata?.['application-id'] === a.applicationId &&
        metadata?.['version-name'] === a.versionName &&
        metadata?.['version-code'] === String(a.buildNumber),
    );
  }
  async head(a: Artifact, signal: AbortSignal) {
    a = artifactSchema.parse(a);
    const result = await this.client.send(new HeadObjectCommand({ Bucket: a.bucket, Key: a.key }), {
      abortSignal: signal,
    });
    this.validate(
      a,
      result.Metadata,
      result.ContentLength,
      result.ContentType,
      result.ContentDisposition,
    );
  }
  async get(a: Artifact, signal: AbortSignal) {
    a = artifactSchema.parse(a);
    const result = await this.client.send(new GetObjectCommand({ Bucket: a.bucket, Key: a.key }), {
      abortSignal: signal,
    });
    try {
      this.validate(
        a,
        result.Metadata,
        result.ContentLength,
        result.ContentType,
        result.ContentDisposition,
      );
      assertDownload(result.Body instanceof Readable);
      return result.Body;
    } catch (error) {
      if (result.Body instanceof Readable) result.Body.destroy();
      throw error;
    }
  }
  close() {
    this.client.destroy();
  }
}
