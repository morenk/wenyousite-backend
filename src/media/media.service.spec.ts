import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
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

const makeMedia = (overrides = {}) => ({
  id: 'm1', userId: 'u1', url: 'https://test.cos.com/test-bucket/...', key: 'uploads/2099/01/01/u1/photo.jpg',
  status: 'UPLOADING', size: null, width: null, height: null, createdAt: new Date(),
  ...overrides,
});

const mockPrisma = {
  media: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
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

  // ── getUploadUrl ──

  it('合法请求应返回预签名 URL 和 mediaId', async () => {
    mockPrisma.media.create.mockResolvedValue(makeMedia());
    const result = await service.getUploadUrl({
      filename: 'photo.jpg', contentType: 'image/jpeg', size: 100000, userId: 'u1',
    });
    expect(result.uploadUrl).toBeDefined();
    expect(result.mediaId).toBe('m1');
    expect(result.objectKey).toContain('uploads/');
    expect(result.publicUrl).toContain('test-bucket');
    expect(mockPrisma.media.create).toHaveBeenCalled();
  });

  it('非法 MIME 类型应拒绝', async () => {
    await expect(
      service.getUploadUrl({ filename: 'bad.txt', contentType: 'text/plain', size: 100, userId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.media.create).not.toHaveBeenCalled();
  });

  it('超大文件应拒绝', async () => {
    const bigSize = 11 * 1024 * 1024;
    await expect(
      service.getUploadUrl({ filename: 'big.jpg', contentType: 'image/jpeg', size: bigSize, userId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.media.create).not.toHaveBeenCalled();
  });

  it('文件名应消毒（双重扩展名攻击防护）', async () => {
    mockPrisma.media.create.mockResolvedValue(makeMedia());
    const result = await service.getUploadUrl({
      filename: 'photo.jpg.exe', contentType: 'image/jpeg', size: 100000, userId: 'u1',
    });
    expect(result.objectKey).toContain('.bin');
  });

  // ── confirmUpload ──

  it('confirmUpload 应校验 mediaId 存在性', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(null);
    mockS3.send.mockResolvedValue({ Body: null });
    await expect(service.confirmUpload('nonexistent', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('confirmUpload 应拒绝他人上传的记录', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia({ userId: 'otherUser' }));
    mockS3.send.mockResolvedValue({ Body: null });
    await expect(service.confirmUpload('m1', 'u1')).rejects.toThrow(ForbiddenException);
  });

  it('confirmUpload 应拒绝非 UPLOADING 状态的记录', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia({ status: 'COMPLETED' }));
    mockS3.send.mockResolvedValue({ Body: null });
    await expect(service.confirmUpload('m1', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('confirmUpload S3 对象不存在应返回 404', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia());
    mockS3.send.mockRejectedValue(new Error('NoSuchKey'));
    await expect(service.confirmUpload('m1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('confirmUpload 应转 PROCESSING 并入队图片处理', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia());
    mockS3.send.mockResolvedValue({ Body: null });
    mockPrisma.media.update.mockResolvedValue(makeMedia({ status: 'PROCESSING' }));

    const result = await service.confirmUpload('m1', 'u1');
    expect(mockImageQueue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ objectKey: 'uploads/2099/01/01/u1/photo.jpg' }),
      expect.any(Object),
    );
    expect(result.processing).toBe(true);
    expect(result.media.status).toBe('PROCESSING');
  });

  it('confirmUpload SVG 不入队处理，直接 COMPLETED', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia({ key: 'uploads/2099/01/01/u1/icon.svg' }));
    mockS3.send.mockResolvedValue({ Body: null });
    mockPrisma.media.update.mockResolvedValue(makeMedia({ key: 'uploads/2099/01/01/u1/icon.svg', status: 'COMPLETED' }));

    const result = await service.confirmUpload('m1', 'u1');
    expect(result.processing).toBe(false);
    expect(result.media.status).toBe('COMPLETED');
    expect(mockImageQueue.add).not.toHaveBeenCalled();
  });

  // ── getMedia ──

  it('getMedia 应返回属于当前用户的媒体记录', async () => {
    const m = makeMedia({ status: 'COMPLETED' });
    mockPrisma.media.findUnique.mockResolvedValue(m);
    const result = await service.getMedia('m1', 'u1');
    expect(result).toEqual(m);
  });

  it('getMedia 不应返回不存在的记录', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(null);
    await expect(service.getMedia('nonexistent', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('getMedia 拒绝非所属用户', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia({ userId: 'otherUser' }));
    await expect(service.getMedia('m1', 'u1')).rejects.toThrow(ForbiddenException);
  });

  // ── markFailed ──

  it('markFailed 应更新状态为 FAILED', async () => {
    mockPrisma.media.update.mockResolvedValue(makeMedia({ status: 'FAILED' }));
    await service.markFailed('m1');
    expect(mockPrisma.media.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'FAILED' },
    });
  });
});
