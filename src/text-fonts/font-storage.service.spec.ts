import { ConfigService } from '@nestjs/config';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectStorageService, ObjectUploadOptions } from '../storage/object-storage.service';
import { FontStorageService } from './font-storage.service';

describe('字体通过唯一适配器保存私有不可变对象', () => {
  let root: string;
  let storage: FontStorageService;
  let data: Map<string, Buffer>;
  let objects: { upload: jest.Mock; head: jest.Mock; download: jest.Mock; publicUrl: jest.Mock };
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'wenyou-font-storage-test-'));
    data = new Map();
    objects = {
      upload: jest.fn(async (key: string, bytes: Buffer, options: ObjectUploadOptions) => {
        expect(options.bucket).toBe('private-fonts');
        expect(options.ifNoneMatch).toBe('*');
        if (data.has(key)) throw { $metadata: { httpStatusCode: 412 } };
        data.set(key, Buffer.from(bytes));
      }),
      head: jest.fn(async (key: string, bucket: string) => {
        expect(bucket).toBe('private-fonts');
        return { ContentLength: data.get(key)?.length };
      }),
      download: jest.fn(async (key: string, bucket: string, max: number) => {
        expect(bucket).toBe('private-fonts');
        expect(data.get(key)!.length).toBeLessThanOrEqual(max);
        return data.get(key)!;
      }),
      publicUrl: jest.fn(),
    };
    storage = new FontStorageService(
      new ConfigService({
        textFonts: { storageRoot: root, bucket: 'private-fonts' },
        cos: { bucket: 'public-media' },
      }),
      objects as unknown as ObjectStorageService,
    );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true });
  });

  it('显式私有 bucket，重复源不覆盖；清空本地目录不丢失持久原件', async () => {
    const bytes = Buffer.from('synthetic-font-source');
    const first = await storage.putSource(bytes, 'ttf');
    expect(await storage.putSource(bytes, 'ttf')).toEqual(first);
    expect(data.size).toBe(1);
    expect(await fs.readdir(root)).toEqual([]);
    expect(await storage.readSource(first.key, first.sha256, first.bytes)).toEqual(bytes);
    expect(objects.publicUrl).not.toHaveBeenCalled();
  });

  it('相同对象键但字节损坏不能当去重成功，也不能覆盖', async () => {
    const bytes = Buffer.from('verified-font-object');
    const asset = await storage.putAsset(bytes, 'ttf');
    const key = `text-fonts/v2/assets/${asset.sha256}.ttf`;
    data.set(key, Buffer.alloc(bytes.length, 0));
    await expect(storage.putAsset(bytes, 'ttf')).rejects.toThrow('font_asset_identity');
    expect(data.get(key)).toEqual(Buffer.alloc(bytes.length, 0));
    await expect(storage.verifyAssets([asset])).rejects.toThrow('font_asset_identity');
  });

  it('远端缺失/失败不以本地文件替代，内部地址不进入异常', async () => {
    objects.upload.mockRejectedValueOnce(new Error('https://private.invalid/secret-path'));
    await expect(storage.putSource(Buffer.from('source'), 'ttf')).rejects.toThrow(
      '字体存储暂不可用',
    );
    const asset = await storage.putAsset(Buffer.from('good'), 'woff2');
    objects.head.mockResolvedValueOnce({ ContentLength: 999 });
    await expect(storage.readAsset(asset)).rejects.toThrow('font_asset_size');
  });

  it('禁止复用默认公共媒体 bucket，缺私有配置失败关闭', () => {
    for (const bucket of ['', 'public-media']) {
      const unavailable = new FontStorageService(
        new ConfigService({
          textFonts: { storageRoot: root, bucket },
          cos: { bucket: 'public-media' },
        }),
        objects as unknown as ObjectStorageService,
      );
      expect(() => unavailable.requireConfigured()).toThrow('动态字体暂不可用');
    }
  });

  it('冷启动探测只发一次有截止的 HEAD，不下载对象', async () => {
    objects.head.mockResolvedValue({ ContentLength: 1200 });
    await storage.probe({ sha256: 'a'.repeat(64), bytes: 1200, format: 'png' });
    expect(objects.head).toHaveBeenCalledTimes(1);
    expect(objects.head).toHaveBeenCalledWith(
      'text-fonts/v2/assets/' + 'a'.repeat(64) + '.png',
      'private-fonts',
      expect.any(AbortSignal),
    );
    expect(objects.download).not.toHaveBeenCalled();
    expect(objects.upload).not.toHaveBeenCalled();
  });

  it('源、字体分片和元数据超预算均不能进入对象存储', async () => {
    await expect(storage.putSource(Buffer.alloc(67108865), 'ttf')).rejects.toThrow('64 MiB');
    await expect(storage.putAsset(Buffer.alloc(6291457), 'ttf')).rejects.toThrow('font_asset_size');
    await expect(storage.putAsset(Buffer.alloc(4194305), 'json')).rejects.toThrow(
      'font_asset_size',
    );
    expect(objects.upload).not.toHaveBeenCalled();
  });

  it('沙箱输出读取仍拒绝符号链接和长度变化', async () => {
    const file = join(root, 'output');
    await fs.writeFile(file, 'safe');
    expect(await storage.readChecked(file, 4)).toEqual(Buffer.from('safe'));
    await expect(storage.readChecked(file, 5)).rejects.toThrow('font_file_identity');
    await fs.unlink(file);
    await fs.symlink('/etc/passwd', file);
    await expect(storage.readChecked(file, 4)).rejects.toThrow('字体存储暂不可用');
  });
});
