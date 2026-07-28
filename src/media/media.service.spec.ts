import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MediaService } from './media.service';
import { PrismaService } from '../prisma/prisma.service';

const mockS3 = { send: jest.fn() };
const mockImageQueue = { add: jest.fn().mockResolvedValue({}) };
const mockGetSignedUrl = jest.fn().mockResolvedValue('https://presigned.url/upload');

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3),
  PutObjectCommand: jest.fn((opts: any) => opts),
  GetObjectCommand: jest.fn((opts: any) => opts),
}));

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'cos.endpoint': 'https://test.cos.com',
      'cos.region': 'auto',
      'cos.bucket': 'test-bucket',
      'cos.accessKeyId': 'test-key',
      'cos.secretAccessKey': 'test-secret',
    };
    return map[key];
  }),
};

const mockPrisma = {
  media: {
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('MediaService', () => {
  let service: MediaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'BullQueue_image', useValue: mockImageQueue },
      ],
    }).compile();
    service = module.get<MediaService>(MediaService);
    (service as any).s3 = mockS3;
    jest.clearAllMocks();
  });

  it('合法请求应返回预签名 URL', async () => {
    const result = await service.getUploadUrl({
      filename: 'photo.jpg', contentType: 'image/jpeg', size: 100000, userId: 'u1',
    });
    expect(result.uploadUrl).toBeDefined();
    expect(result.objectKey).toContain('uploads/');
    expect(result.publicUrl).toContain('test-bucket');
  });

  it('非法 MIME 类型应拒绝', async () => {
    await expect(
      service.getUploadUrl({ filename: 'bad.txt', contentType: 'text/plain', size: 100, userId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('超大文件应拒绝', async () => {
    const bigSize = 11 * 1024 * 1024;
    await expect(
      service.getUploadUrl({ filename: 'big.jpg', contentType: 'image/jpeg', size: bigSize, userId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('文件名应消毒（双重扩展名攻击防护，非图片扩展名拒绝）', async () => {
    const result = await service.getUploadUrl({
      filename: 'photo.jpg.exe', contentType: 'image/jpeg', size: 100000, userId: 'u1',
    });
    // .exe 不在图片扩展名白名单中，应被替换为 bin
    expect(result.objectKey).toContain('.bin');
  });

  it('confirmUpload 应写入 DB 并入队图片处理', async () => {
    mockS3.send.mockResolvedValue({ Body: null });
    mockPrisma.media.create.mockResolvedValue({ id: 'm1', url: '...', key: 'key123.jpg' });
    const result = await service.confirmUpload('uploads/2026/u1/foo.jpg', 'u1');
    expect(mockPrisma.media.create).toHaveBeenCalled();
    expect(mockImageQueue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ objectKey: 'uploads/2026/u1/foo.jpg' }),
      expect.any(Object),
    );
    expect(result.processing).toBe(true);
  });

  it('confirmUpload SVG 不入队处理', async () => {
    mockS3.send.mockResolvedValue({ Body: null });
    mockPrisma.media.create.mockResolvedValue({ id: 'm1', url: '...', key: 'icon.svg' });
    const result = await service.confirmUpload('uploads/icon.svg', 'u1');
    expect(result.processing).toBe(false);
  });

  it('confirmUpload S3 对象不存在应返回 404', async () => {
    mockS3.send.mockRejectedValue(new Error('NoSuchKey'));
    await expect(service.confirmUpload('uploads/missing.jpg', 'u1')).rejects.toThrow(NotFoundException);
  });
});
