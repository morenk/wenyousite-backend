import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectStorageService } from './object-storage.service';

const client = { send: jest.fn() };

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => client),
  GetObjectCommand: jest.fn((options: unknown) => options),
  PutObjectCommand: jest.fn((options: unknown) => options),
  HeadObjectCommand: jest.fn((options: unknown) => options),
  DeleteObjectCommand: jest.fn((options: unknown) => options),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

describe('ObjectStorageService', () => {
  const config = { get: jest.fn() };
  let service: ObjectStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation(
      (key: string) =>
        ({
          'cos.bucket': 'test-bucket',
          'cos.endpoint': 'https://storage.example.com/',
          'cos.region': 'auto',
          'cos.accessKeyId': 'access-key',
          'cos.secretAccessKey': 'secret-key',
        })[key],
    );
    service = new ObjectStorageService(config as unknown as ConfigService);
  });

  it('以统一配置创建路径风格 S3 客户端', () => {
    expect(S3Client).toHaveBeenCalledWith({
      endpoint: 'https://storage.example.com/',
      region: 'auto',
      credentials: { accessKeyId: 'access-key', secretAccessKey: 'secret-key' },
      forcePathStyle: true,
    });
  });

  it('提供元数据、流式下载和上传能力', async () => {
    async function* body() {
      yield Uint8Array.from([1, 2]);
      yield Uint8Array.from([3, 4]);
    }
    client.send
      .mockResolvedValueOnce({ ContentLength: 4 })
      .mockResolvedValueOnce({ Body: body() })
      .mockResolvedValueOnce({});

    await service.head('a.webp');
    await expect(service.download('a.webp')).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
    await service.upload('a.webp', Buffer.from('image'), { contentType: 'image/webp' });

    expect(HeadObjectCommand).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'a.webp' });
    expect(GetObjectCommand).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'a.webp' });
    expect(PutObjectCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ Bucket: 'test-bucket', Key: 'a.webp', ContentType: 'image/webp' }),
    );
  });

  it('批量删除返回失败 key 供上层重试', async () => {
    client.send
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({});

    await expect(service.removeMany(['a', 'b', 'c'])).resolves.toEqual(new Set(['b']));
    expect(DeleteObjectCommand).toHaveBeenCalledTimes(3);
  });

  it('统一生成预签名地址和公开地址', async () => {
    jest.mocked(getSignedUrl).mockResolvedValue('https://signed.example.com' as never);

    await expect(
      service.signUploadUrl({ key: 'a.webp', contentType: 'image/webp', size: 4 }),
    ).resolves.toBe('https://signed.example.com');
    expect(service.publicUrl('a.webp')).toBe('https://storage.example.com/test-bucket/a.webp');
  });
});
