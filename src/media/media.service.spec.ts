import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MediaReferenceService } from './media-reference.service';
import { ErrorCode } from '../common/exceptions/error-codes';

const mockS3 = { send: jest.fn() };
const mockImageQueue = { add: jest.fn().mockResolvedValue({}) };
const mockGetSignedUrl = jest.fn().mockResolvedValue('https://presigned.url/upload');
const mockRedis = {
  hincrby: jest.fn().mockResolvedValue(1),
  hget: jest.fn().mockResolvedValue('1'),
  expire: jest.fn().mockResolvedValue(1),
};
const mockMediaReferences = {
  reconcileAllMarkers: jest.fn().mockResolvedValue(undefined),
  filterUnreferenced: jest.fn(async (ids: string[]) => ids),
};

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => mockS3),
  PutObjectCommand: jest.fn((opts: any) => opts),
  GetObjectCommand: jest.fn((opts: any) => opts),
  HeadObjectCommand: jest.fn((opts: any) => opts),
  DeleteObjectCommand: jest.fn((opts: any) => opts),
}));

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'cos.endpoint': 'https://test.cos.com',
      'cos.region': 'auto',
      'cos.bucket': 'test-bucket',
      'cos.accessKeyId': 'test-key',
      'cos.secretAccessKey': 'test-secret',
      'upload.ratePerHour': 60,
    };
    return map[key];
  }),
};

const makeMedia = (overrides = {}) => ({
  id: 'm1',
  userId: 'u1',
  url: 'https://test.cos.com/test-bucket/...',
  key: 'uploads/2099/01/01/u1/photo.jpg',
  status: 'UPLOADING',
  contentType: 'image/jpeg',
  size: 100000,
  width: null,
  height: null,
  createdAt: new Date(),
  ...overrides,
});

const mockPrisma = {
  media: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: { findMany: jest.fn(), findFirst: jest.fn() },
  post: { findMany: jest.fn(), findFirst: jest.fn() },
  draft: { findMany: jest.fn(), findFirst: jest.fn() },
  directMessage: { findMany: jest.fn(), findFirst: jest.fn() },
  momentImage: { findMany: jest.fn(), findFirst: jest.fn() },
  momentComment: { findMany: jest.fn(), findFirst: jest.fn() },
  stickerImport: { findFirst: jest.fn() },
};

describe('MediaService', () => {
  let service: MediaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: MediaReferenceService, useValue: mockMediaReferences },
        { provide: 'BullQueue_image', useValue: mockImageQueue },
      ],
    }).compile();
    service = module.get<MediaService>(MediaService);
    (service as any).s3 = mockS3;
    jest.clearAllMocks();
    mockS3.send.mockReset();
    mockPrisma.media.findMany.mockReset().mockResolvedValue([]);
    mockMediaReferences.reconcileAllMarkers.mockReset().mockResolvedValue(0);
    mockMediaReferences.filterUnreferenced
      .mockReset()
      .mockImplementation(async (ids: string[]) => ids);
    jest
      .spyOn(
        (service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    mockRedis.hincrby.mockResolvedValue(1);
    mockPrisma.directMessage.findMany.mockResolvedValue([]);
    mockPrisma.directMessage.findFirst.mockResolvedValue(null);
    mockPrisma.momentImage.findMany.mockResolvedValue([]);
    mockPrisma.momentImage.findFirst.mockResolvedValue(null);
    mockPrisma.momentComment.findMany.mockResolvedValue([]);
    mockPrisma.momentComment.findFirst.mockResolvedValue(null);
    mockPrisma.stickerImport.findFirst.mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── getUploadUrl ──

  it('合法请求应返回预签名 URL 和 mediaId', async () => {
    mockPrisma.media.create.mockResolvedValue(makeMedia());
    const result = await service.getUploadUrl({
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 100000,
      userId: 'u1',
    });
    expect(result.uploadUrl).toBeDefined();
    expect(result.mediaId).toBe('m1');
    expect(result.objectKey).toContain('uploads/');
    expect(result.publicUrl).toContain('test-bucket');
    expect(mockPrisma.media.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contentType: 'image/jpeg', size: 100000 }),
    });
  });

  it('非法 MIME 类型应拒绝', async () => {
    await expect(
      service.getUploadUrl({
        filename: 'bad.txt',
        contentType: 'text/plain',
        size: 100,
        userId: 'u1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.media.create).not.toHaveBeenCalled();
  });

  it('SVG 应在签发上传凭证前拒绝', async () => {
    await expect(
      service.getUploadUrl({
        filename: 'unsafe.svg',
        contentType: 'image/svg+xml',
        size: 100,
        userId: 'u1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.media.create).not.toHaveBeenCalled();
  });

  it('reissueUploadUrl 应为同一 UPLOADING 记录和对象键重新签名', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia());

    const result = await service.reissueUploadUrl('m1', 'u1');

    expect(result).toEqual(
      expect.objectContaining({
        mediaId: 'm1',
        objectKey: 'uploads/2099/01/01/u1/photo.jpg',
        uploadUrl: 'https://presigned.url/upload',
      }),
    );
    expect(mockPrisma.media.create).not.toHaveBeenCalled();
    expect(mockRedis.hincrby).not.toHaveBeenCalled();
  });

  it('reissueUploadUrl 应拒绝非 UPLOADING 记录', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia({ status: 'FAILED' }));

    await expect(service.reissueUploadUrl('m1', 'u1')).rejects.toThrow(BadRequestException);

    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('超大文件应拒绝', async () => {
    const bigSize = 11 * 1024 * 1024;
    await expect(
      service.getUploadUrl({
        filename: 'big.jpg',
        contentType: 'image/jpeg',
        size: bigSize,
        userId: 'u1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.media.create).not.toHaveBeenCalled();
  });

  it('文件名应消毒（双重扩展名攻击防护）', async () => {
    mockPrisma.media.create.mockResolvedValue(makeMedia());
    const result = await service.getUploadUrl({
      filename: 'photo.jpg.exe',
      contentType: 'image/jpeg',
      size: 100000,
      userId: 'u1',
    });
    expect(result.objectKey).toContain('.bin');
  });

  it('对象键使用密码学随机后缀而不是 Math.random', async () => {
    const random = jest.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('object key must not use Math.random');
    });
    mockPrisma.media.create.mockResolvedValue(makeMedia());

    await expect(
      service.getUploadUrl({
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
        size: 100000,
        userId: 'u1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ objectKey: expect.stringMatching(/-[0-9a-f]{16}\.jpg$/) }),
    );
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
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

  it.each([
    ['PROCESSING', true],
    ['COMPLETED', false],
  ])('confirmUpload 对 %s 状态应幂等返回且不重复入队', async (status, processing) => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia({ status }));
    const result = await service.confirmUpload('m1', 'u1');
    expect(result).toEqual({ media: expect.objectContaining({ status }), processing });
    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockImageQueue.add).not.toHaveBeenCalled();
  });

  it('confirmUpload 应拒绝 FAILED 状态的记录', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia({ status: 'FAILED' }));
    await expect(service.confirmUpload('m1', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('confirmUpload S3 对象不存在应返回 404', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia());
    mockS3.send.mockRejectedValue({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    await expect(service.confirmUpload('m1', 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.MEDIA_OBJECT_MISSING,
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('confirmUpload 对象存储临时故障应原样抛出以便客户端重试确认', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia());
    mockS3.send.mockRejectedValue(new Error('storage unavailable'));

    await expect(service.confirmUpload('m1', 'u1')).rejects.toThrow('storage unavailable');

    expect(mockPrisma.media.updateMany).not.toHaveBeenCalled();
  });

  it('confirmUpload 应转 PROCESSING 并入队图片处理', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia());
    mockS3.send.mockResolvedValue({ ContentLength: 100000, ContentType: 'image/jpeg' });
    mockPrisma.media.update.mockResolvedValue(makeMedia({ status: 'PROCESSING' }));

    const result = await service.confirmUpload('m1', 'u1');
    expect(mockImageQueue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ objectKey: 'uploads/2099/01/01/u1/photo.jpg' }),
      expect.objectContaining({ jobId: 'm1' }),
    );
    expect(mockPrisma.media.update).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'UPLOADING' },
      data: { status: 'PROCESSING', size: 100000, contentType: 'image/jpeg' },
    });
    expect(mockPrisma.media.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockImageQueue.add.mock.invocationCallOrder[0],
    );
    expect(result.processing).toBe(true);
    expect(result.media.status).toBe('PROCESSING');
  });

  it.each([
    [{ ContentLength: 99999, ContentType: 'image/jpeg' }, '大小不一致'],
    [{ ContentLength: 100000, ContentType: 'image/png' }, '类型不一致'],
    [{ ContentLength: undefined, ContentType: 'image/jpeg' }, '大小缺失'],
    [{ ContentLength: 100000, ContentType: undefined }, '类型缺失'],
  ])('confirmUpload 对对象元数据%s应标记 FAILED', async (headResult, _reason) => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia());
    mockS3.send.mockResolvedValue(headResult);
    mockPrisma.media.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.confirmUpload('m1', 'u1')).rejects.toThrow(BadRequestException);
    expect(mockPrisma.media.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'UPLOADING' },
      data: { status: 'FAILED' },
    });
    expect(mockImageQueue.add).not.toHaveBeenCalled();
  });

  it('confirmUpload 并发条件更新失败时应返回另一请求写入的状态', async () => {
    mockPrisma.media.findUnique
      .mockResolvedValueOnce(makeMedia())
      .mockResolvedValueOnce(makeMedia({ status: 'PROCESSING' }));
    mockS3.send.mockResolvedValue({ ContentLength: 100000, ContentType: 'image/jpeg' });
    mockPrisma.media.update.mockRejectedValueOnce({ code: 'P2025' });

    const result = await service.confirmUpload('m1', 'u1');
    expect(result.processing).toBe(true);
    expect(result.media.status).toBe('PROCESSING');
    expect(mockImageQueue.add).not.toHaveBeenCalled();
  });

  it('confirmUpload 入队失败时应条件回滚以允许重试', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(makeMedia());
    mockS3.send.mockResolvedValue({ ContentLength: 100000, ContentType: 'image/jpeg' });
    mockPrisma.media.update.mockResolvedValue(makeMedia({ status: 'PROCESSING' }));
    mockImageQueue.add.mockRejectedValueOnce(new Error('redis unavailable'));
    mockPrisma.media.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.confirmUpload('m1', 'u1')).rejects.toThrow('redis unavailable');
    expect(mockPrisma.media.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'PROCESSING' },
      data: { status: 'UPLOADING' },
    });
  });

  // ── getMedia ──

  it('getMedia 应返回属于当前用户的媒体记录', async () => {
    const m = makeMedia({ status: 'COMPLETED' });
    mockPrisma.media.findUnique.mockResolvedValue(m);
    const result = await service.getMedia('m1', 'u1');
    expect(result).toEqual({ ...m, thumbnailUrl: null, mediumUrl: null, feedUrl: null });
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
    mockPrisma.media.updateMany.mockResolvedValue({ count: 1 });
    await service.markFailed('m1');
    expect(mockPrisma.media.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'PROCESSING' },
      data: { status: 'FAILED' },
    });
  });

  it('markFailed 不会把已完成媒体从 COMPLETED 回退为 FAILED', async () => {
    mockPrisma.media.updateMany.mockResolvedValue({ count: 0 });

    await service.markFailed('m1');

    expect(mockPrisma.media.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'PROCESSING' },
      data: { status: 'FAILED' },
    });
  });

  // ── 每用户小时配额 ──

  it('getUploadUrl 超过每用户小时配额应返回 429', async () => {
    mockRedis.hincrby.mockResolvedValue(61);
    try {
      await service.getUploadUrl({
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
        size: 100000,
        userId: 'u1',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
    expect(mockPrisma.media.create).not.toHaveBeenCalled();
  });

  it('getUploadUrl 未超配额时正常放行并计数', async () => {
    mockPrisma.media.create.mockResolvedValue(makeMedia());
    const result = await service.getUploadUrl({
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 100000,
      userId: 'u1',
    });
    expect(result.uploadUrl).toBeDefined();
    expect(mockRedis.hincrby).toHaveBeenCalledWith('media:uploads:hour:u1', expect.any(String), 1);
    expect(mockRedis.expire).toHaveBeenCalled();
  });

  // ── 孤儿图片回收 ──

  it('cleanupOrphanByUrl 可删除无引用的失败媒体及派生图', async () => {
    const url = 'https://test.cos.com/test-bucket/uploads/avatar.jpg';
    mockPrisma.media.findFirst.mockResolvedValue({
      id: 'm-avatar',
      key: 'uploads/avatar.jpg',
      status: 'FAILED',
    });
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.post.findFirst.mockResolvedValue(null);
    mockPrisma.draft.findFirst.mockResolvedValue(null);
    mockS3.send.mockResolvedValue({});

    await expect(service.cleanupOrphanByUrl(url)).resolves.toBe(true);

    const keys = mockS3.send.mock.calls.map(([command]) => command.Key);
    expect(keys).toEqual([
      'uploads/avatar.jpg',
      'uploads/avatar_thumb.webp',
      'uploads/avatar_feed.webp',
      'uploads/avatar_md.webp',
    ]);
    expect(mockPrisma.media.deleteMany).toHaveBeenCalledWith({
      where: { id: 'm-avatar' },
    });
  });

  it('cleanupOrphanByUrl 在引用账本建立前保守保留 COMPLETED 媒体', async () => {
    const url = 'https://test.cos.com/test-bucket/uploads/avatar.jpg';
    mockPrisma.media.findFirst.mockResolvedValue({
      id: 'm-avatar',
      key: 'uploads/avatar.jpg',
      status: 'COMPLETED',
    });

    await expect(service.cleanupOrphanByUrl(url)).resolves.toBe(false);

    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
  });

  it('cleanupOrphanByUrl 检测到正文引用时应保留头像文件', async () => {
    const url = 'https://test.cos.com/test-bucket/uploads/avatar.jpg';
    mockPrisma.media.findFirst.mockResolvedValue({
      id: 'm-avatar',
      key: 'uploads/avatar.jpg',
      status: 'FAILED',
    });
    mockMediaReferences.filterUnreferenced.mockResolvedValueOnce([]);

    await expect(service.cleanupOrphanByUrl(url)).resolves.toBe(false);

    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
  });

  it('cleanupOrphanMedia 默认不把 COMPLETED 图片列为清理对象', async () => {
    mockPrisma.media.findMany.mockResolvedValue([]);
    mockS3.send.mockResolvedValue({});
    mockPrisma.media.deleteMany.mockResolvedValue({ count: 1 });

    await service.cleanupOrphanMedia();

    expect(mockMediaReferences.reconcileAllMarkers).toHaveBeenCalled();
    expect(mockPrisma.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.not.arrayContaining([expect.objectContaining({ status: 'COMPLETED' })]),
        }),
      }),
    );
    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
  });

  it('cleanupOrphanMedia 应保留仍被引用的图片', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([
      {
        id: 'p1',
        content: '![keep](https://test.cos.com/test-bucket/uploads/2099/01/01/u1/photo.jpg)',
      },
    ]);
    mockPrisma.draft.findMany.mockResolvedValue([]);
    mockPrisma.media.findMany.mockResolvedValue([
      {
        id: 'm1',
        key: 'uploads/2099/01/01/u1/photo.jpg',
        url: 'https://test.cos.com/test-bucket/uploads/2099/01/01/u1/photo.jpg',
        status: 'FAILED',
      },
    ]);
    mockMediaReferences.filterUnreferenced.mockResolvedValueOnce([]);

    await service.cleanupOrphanMedia();

    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
  });

  it('cleanupOrphanMedia 应保留仍被未撤回私聊引用的图片', async () => {
    const url = 'https://test.cos.com/test-bucket/uploads/2099/01/01/u1/private.jpg';
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.draft.findMany.mockResolvedValue([]);
    mockPrisma.directMessage.findMany.mockResolvedValue([{ id: 'dm1', media: { url } }]);
    mockPrisma.media.findMany.mockResolvedValue([
      { id: 'm1', key: 'uploads/2099/01/01/u1/private.jpg', url, status: 'FAILED' },
    ]);
    mockMediaReferences.filterUnreferenced.mockResolvedValueOnce([]);

    await service.cleanupOrphanMedia();

    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
  });

  it('cleanupOrphanMedia 应保留仍被动态评论引用的图片', async () => {
    const url = 'https://test.cos.com/test-bucket/uploads/2099/01/01/u1/comment.webp';
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.draft.findMany.mockResolvedValue([]);
    mockPrisma.momentComment.findMany.mockResolvedValue([{ media: { url } }]);
    mockPrisma.media.findMany.mockResolvedValue([
      { id: 'm1', key: 'uploads/2099/01/01/u1/comment.webp', url, status: 'FAILED' },
    ]);
    mockMediaReferences.filterUnreferenced.mockResolvedValueOnce([]);

    await service.cleanupOrphanMedia();

    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
  });

  it('cleanupOrphanMedia 应清理僵尸 UPLOADING 与 FAILED 图片', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', content: '![keep](https://test.cos.com/test-bucket/uploads/keep/a.jpg)' },
    ]);
    mockPrisma.draft.findMany.mockResolvedValue([]);
    mockPrisma.media.findMany.mockResolvedValue([
      {
        id: 'm1',
        key: 'uploads/2099/01/01/u1/stale.jpg',
        url: 'https://test.cos.com/test-bucket/uploads/2099/01/01/u1/stale.jpg',
        status: 'UPLOADING',
      },
      {
        id: 'm2',
        key: 'uploads/2099/01/01/u1/failed.svg',
        url: 'https://test.cos.com/test-bucket/uploads/2099/01/01/u1/failed.svg',
        status: 'FAILED',
      },
    ]);
    mockS3.send.mockResolvedValue({});

    await service.cleanupOrphanMedia();

    expect(mockPrisma.media.deleteMany).toHaveBeenCalled();
  });

  it('cleanupOrphanMedia SVG 只删除自身，不生成派生图', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', content: '![keep](https://test.cos.com/test-bucket/uploads/keep/a.jpg)' },
    ]);
    mockPrisma.draft.findMany.mockResolvedValue([]);
    mockPrisma.media.findMany.mockResolvedValue([
      {
        id: 'm1',
        key: 'uploads/2099/01/01/u1/icon.svg',
        url: 'https://test.cos.com/test-bucket/uploads/2099/01/01/u1/icon.svg',
        status: 'FAILED',
      },
    ]);
    mockS3.send.mockResolvedValue({});

    await service.cleanupOrphanMedia();

    const keys = mockS3.send.mock.calls.map(([command]) => command.Key);
    expect(keys).toEqual(['uploads/2099/01/01/u1/icon.svg']);
  });

  it('cleanupOrphanMedia 无过期候选时应跳过对象存储清理', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.draft.findMany.mockResolvedValue([]);

    await service.cleanupOrphanMedia();

    expect(mockPrisma.media.findMany).toHaveBeenCalled();
    expect(mockS3.send).not.toHaveBeenCalled();
  });

  it('cleanupOrphanMedia 原图删除失败时保留 DB 记录待下次重试', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([
      { id: 'p1', content: '![keep](https://test.cos.com/test-bucket/uploads/keep/a.jpg)' },
    ]);
    mockPrisma.draft.findMany.mockResolvedValue([]);
    const key = 'uploads/2099/01/01/u1/photo.jpg';
    mockPrisma.media.findMany.mockResolvedValue([
      { id: 'm1', key, url: `https://test.cos.com/test-bucket/${key}`, status: 'FAILED' },
    ]);
    mockS3.send.mockRejectedValue(new Error('delete failed'));

    await service.cleanupOrphanMedia();

    expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
  });

  it('cleanupOrphanMedia 能识别尖括号 Markdown URL，不误删合法引用', async () => {
    const url = 'https://test.cos.com/test-bucket/uploads/2099/01/01/u1/angle.jpg';
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p1', content: `![keep](<${url}>)` }]);
    mockPrisma.draft.findMany.mockResolvedValue([]);
    mockPrisma.media.findMany.mockResolvedValue([
      { id: 'm1', key: 'uploads/2099/01/01/u1/angle.jpg', url, status: 'FAILED' },
    ]);
    mockMediaReferences.filterUnreferenced.mockResolvedValueOnce([]);

    await service.cleanupOrphanMedia();

    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.media.deleteMany).not.toHaveBeenCalled();
  });
});
