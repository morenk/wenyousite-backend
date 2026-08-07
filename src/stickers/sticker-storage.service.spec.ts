import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { StickerStorageService } from './sticker-storage.service';

const mockS3 = { send: jest.fn() };

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3),
  GetObjectCommand: jest.fn((options: unknown) => options),
  PutObjectCommand: jest.fn((options: unknown) => options),
  DeleteObjectCommand: jest.fn((options: unknown) => options),
}));

describe('StickerStorageService', () => {
  const config = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) => ({
      'cos.bucket': 'test-bucket',
      'cos.endpoint': 'https://storage.example.com/',
      'cos.region': 'auto',
      'cos.accessKeyId': 'access-key',
      'cos.secretAccessKey': 'secret-key',
    })[key]);
  });

  it('使用路径风格和配置凭据创建 S3 客户端', () => {
    new StickerStorageService(config as unknown as ConfigService);

    expect(S3Client).toHaveBeenCalledWith({
      endpoint: 'https://storage.example.com/',
      region: 'auto',
      credentials: { accessKeyId: 'access-key', secretAccessKey: 'secret-key' },
      forcePathStyle: true,
    });
  });

  it('流式下载对象并按顺序拼接所有字节块', async () => {
    async function* body() {
      yield Uint8Array.from([1, 2]);
      yield Uint8Array.from([3, 4]);
    }
    mockS3.send.mockResolvedValue({ Body: body() });
    const service = new StickerStorageService(config as unknown as ConfigService);

    await expect(service.download('stickers/a.webp')).resolves.toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'stickers/a.webp',
    });
  });

  it('无响应体时下载为空 Buffer', async () => {
    mockS3.send.mockResolvedValue({ Body: undefined });
    const service = new StickerStorageService(config as unknown as ConfigService);

    await expect(service.download('stickers/empty.webp')).resolves.toEqual(Buffer.alloc(0));
  });

  it('上传 WebP 时设置不可变缓存头', async () => {
    mockS3.send.mockResolvedValue({});
    const service = new StickerStorageService(config as unknown as ConfigService);
    const body = Buffer.from('image');

    await service.upload('stickers/a.webp', body);

    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'stickers/a.webp',
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('删除指定 bucket 中的对象', async () => {
    mockS3.send.mockResolvedValue({});
    const service = new StickerStorageService(config as unknown as ConfigService);

    await service.remove('stickers/a.webp');

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'stickers/a.webp',
    });
  });

  it('自定义 endpoint 去除尾斜杠后生成公开 URL', () => {
    const service = new StickerStorageService(config as unknown as ConfigService);

    expect(service.publicUrl('stickers/a.webp')).toBe(
      'https://storage.example.com/test-bucket/stickers/a.webp',
    );
  });

  it('无 endpoint 时回退到 AWS S3 公网地址', () => {
    config.get.mockImplementation((key: string) => ({
      'cos.bucket': 'test-bucket',
      'cos.endpoint': '',
      'cos.region': 'ap-southeast-1',
      'cos.accessKeyId': 'access-key',
      'cos.secretAccessKey': 'secret-key',
    })[key]);
    const service = new StickerStorageService(config as unknown as ConfigService);

    expect(service.publicUrl('stickers/a.webp')).toBe(
      'https://test-bucket.s3.ap-southeast-1.amazonaws.com/stickers/a.webp',
    );
  });
});
