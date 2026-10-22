import { Injectable, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { ObjectStorageService } from '../storage/object-storage.service';
import { FontAssetDto } from './dto/font-public.dto';
import { FONT_SOURCE_MAX_BYTES } from './font-protocol';
import { fontSha } from './font-domain';
import { FONT_DOCUMENT_MAX_BYTES, FONT_SHARD_MAX_BYTES } from './font-manifest';

function storageFailure(error: unknown): never {
  if (
    error instanceof BusinessException ||
    (error instanceof Error && /^font_[a-z_]+$/u.test(error.message))
  )
    throw error;
  throw new BusinessException(
    ErrorCode.TEXT_FONT_UNAVAILABLE,
    '字体存储暂不可用，请稍后重试',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
const mime: Record<FontAssetDto['format'], string> = {
  json: 'application/json',
  png: 'image/png',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** 唯一 S3 适配器保存持久事实；本机目录只容纳受限处理工作区。 */
@Injectable()
export class FontStorageService {
  constructor(
    private readonly config: ConfigService,
    private readonly objects?: ObjectStorageService,
  ) {}

  requireConfigured(): string {
    const root = this.config.get<string>('textFonts.storageRoot');
    const bucket = this.config.get<string>('textFonts.bucket');
    if (
      !root?.startsWith('/') ||
      !bucket ||
      bucket === this.config.get<string>('cos.bucket') ||
      !this.objects
    ) {
      throw new BusinessException(
        ErrorCode.TEXT_FONT_UNAVAILABLE,
        '动态字体暂不可用，请稍后重试',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return resolve(root);
  }

  async directory(kind: 'work'): Promise<string> {
    return this.checkedDirectory(kind).catch(storageFailure);
  }

  private async checkedDirectory(kind: 'work'): Promise<string> {
    const root = this.requireConfigured();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await lstat(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0 ||
      (await realpath(root)) !== root
    )
      throw new Error('font_storage_identity');
    const directory = join(root, kind);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const child = await lstat(directory);
    if (
      !child.isDirectory() ||
      child.isSymbolicLink() ||
      child.uid !== stat.uid ||
      (child.mode & 0o077) !== 0
    )
      throw new Error('font_storage_identity');
    return directory;
  }

  private bucket(): string {
    this.requireConfigured();
    return this.config.get<string>('textFonts.bucket')!;
  }

  async putSource(source: Buffer, format: 'ttf' | 'otf') {
    if (!Buffer.isBuffer(source) || source.length === 0 || source.length > FONT_SOURCE_MAX_BYTES)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择不超过 64 MiB 的单个字体文件');
    const sha256 = fontSha(source),
      key = `${sha256}.${format}`;
    await this.putObject(`text-fonts/v2/sources/${key}`, source, sha256, mime[format]).catch(
      storageFailure,
    );
    return { key, sha256, bytes: source.length };
  }

  async readSource(key: string, sha256: string, bytes: number): Promise<Buffer> {
    if (
      !/^[a-f0-9]{64}\.(?:ttf|otf)$/u.test(key) ||
      key.split('.')[0] !== sha256 ||
      bytes > FONT_SOURCE_MAX_BYTES
    )
      throw new Error('font_source_identity');
    return this.readObject(`text-fonts/v2/sources/${key}`, sha256, bytes).catch(storageFailure);
  }

  async putAsset(source: Buffer, format: FontAssetDto['format']): Promise<FontAssetDto> {
    const limit =
      format === 'json' || format === 'png' ? FONT_DOCUMENT_MAX_BYTES : FONT_SHARD_MAX_BYTES;
    if (!source.length || source.length > limit) throw new Error('font_asset_size');
    const sha256 = fontSha(source);
    await this.putObject(
      `text-fonts/v2/assets/${sha256}.${format}`,
      source,
      sha256,
      mime[format],
    ).catch(storageFailure);
    return { sha256, bytes: source.length, format };
  }

  private async putObject(key: string, bytes: Buffer, sha256: string, contentType: string) {
    const bucket = this.bucket();
    try {
      await this.objects!.upload(key, bytes, {
        bucket,
        contentType,
        contentLength: bytes.length,
        cacheControl: 'private, no-store',
        ifNoneMatch: '*',
      });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status !== 409 && status !== 412) throw error;
    }
    // 已存在或并发 PUT 都必须复验远端，不能以本地缓存代替发布可读性。
    await this.readObject(key, sha256, bytes.length);
  }

  private async readObject(key: string, sha256: string, bytes: number): Promise<Buffer> {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > FONT_SOURCE_MAX_BYTES)
      throw new Error('font_asset_size');
    const bucket = this.bucket();
    const signal = AbortSignal.timeout(30000);
    const head = await this.objects!.head(key, bucket, signal);
    if (head.ContentLength !== bytes) throw new Error('font_asset_size');
    const data = await this.objects!.download(key, bucket, bytes, signal);
    if (data.length !== bytes || fontSha(data) !== sha256) throw new Error('font_asset_identity');
    return data;
  }

  /** 发布事务已完成全量校验；冷启动只探测一个已发布样张的远端可达性。 */
  async probe(asset: FontAssetDto): Promise<void> {
    if (
      !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
      asset.format !== 'png' ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 1 ||
      asset.bytes > FONT_DOCUMENT_MAX_BYTES
    )
      throw new Error('font_asset_identity');
    const head = await this.objects!.head(
      `text-fonts/v2/assets/${asset.sha256}.png`,
      this.bucket(),
      AbortSignal.timeout(3000),
    ).catch(storageFailure);
    if (head.ContentLength !== asset.bytes) throw new Error('font_asset_size');
  }

  async readAsset(asset: FontAssetDto): Promise<Buffer> {
    if (
      !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
      !['woff2', 'ttf', 'otf', 'json', 'png'].includes(asset.format)
    )
      throw new Error('font_asset_identity');
    const limit =
      asset.format === 'json' || asset.format === 'png'
        ? FONT_DOCUMENT_MAX_BYTES
        : FONT_SHARD_MAX_BYTES;
    if (asset.bytes > limit) throw new Error('font_asset_size');
    return this.readObject(
      `text-fonts/v2/assets/${asset.sha256}.${asset.format}`,
      asset.sha256,
      asset.bytes,
    ).catch(storageFailure);
  }

  async readChecked(path: string, expectedBytes: number): Promise<Buffer> {
    return this.checkedRead(path, expectedBytes).catch(storageFailure);
  }

  private async checkedRead(path: string, expectedBytes: number): Promise<Buffer> {
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > FONT_SOURCE_MAX_BYTES
    )
      throw new Error('font_asset_size');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid?.() ||
        stat.size !== expectedBytes
      )
        throw new Error('font_file_identity');
      return await file.readFile();
    } finally {
      await file.close();
    }
  }

  async verifyAssets(assets: FontAssetDto[]): Promise<void> {
    for (const asset of assets) await this.readAsset(asset);
  }
}
