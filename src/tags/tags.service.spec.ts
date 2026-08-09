import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TagsService } from './tags.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { Prisma } from '@prisma/client';

const mockPrisma = {
  topicTag: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
  },
};

const mockEventEmitter = { emit: jest.fn() };
const mockCache = {
  buildKey: jest.fn((...parts: string[]) => parts.join(':')),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

describe('TagsService', () => {
  let service: TagsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get<TagsService>(TagsService);
    jest.clearAllMocks();
  });

  it('search 应该返回匹配的标签', async () => {
    mockPrisma.topicTag.findMany.mockResolvedValue([{ id: 't1', name: '无限流' }]);
    const result = await service.search('无限');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('无限流');
  });

  it('search 无关键字应该返回全部标签', async () => {
    mockPrisma.topicTag.findMany.mockResolvedValue([
      { id: 't1', name: 'A' },
      { id: 't2', name: 'B' },
    ]);
    const result = await service.search();
    expect(result).toHaveLength(2);
  });

  it('create 应该创建新标签', async () => {
    mockPrisma.topicTag.findUnique.mockResolvedValue(null);
    mockPrisma.topicTag.create.mockResolvedValue({ id: 't1', name: '无限流', color: '#FF0000' });
    const result = await service.create({ name: '无限流', color: '#FF0000' });
    expect(result.name).toBe('无限流');
  });

  it('create 会规范化空白，并把并发唯一键冲突转换为 409', async () => {
    mockPrisma.topicTag.findUnique.mockResolvedValue(null);
    mockPrisma.topicTag.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.create({ name: ' 新标签 ' })).rejects.toMatchObject({
      errorCode: ErrorCode.TAG_ALREADY_EXISTS,
      status: 409,
    });
    expect(mockPrisma.topicTag.findUnique).toHaveBeenCalledWith({ where: { name: '新标签' } });
    expect(mockPrisma.topicTag.create).toHaveBeenCalledWith({
      data: { name: '新标签', color: undefined },
    });
  });

  it('create 重复标签应该返回409', async () => {
    mockPrisma.topicTag.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.create({ name: '无限流' })).rejects.toMatchObject({
      errorCode: ErrorCode.TAG_ALREADY_EXISTS,
    });
  });

  it('findById 不存在应该返回404', async () => {
    mockPrisma.topicTag.findUnique.mockResolvedValue(null);
    await expect(service.findById('x')).rejects.toMatchObject({
      errorCode: ErrorCode.TAG_NOT_FOUND,
    });
  });

  it('findOrCreate 应该找到现有标签', async () => {
    mockPrisma.topicTag.findMany.mockResolvedValue([{ id: 't1', name: '无限流' }]);
    mockPrisma.topicTag.createMany.mockResolvedValue({});
    mockPrisma.topicTag.findMany.mockResolvedValueOnce([{ id: 't1', name: '无限流' }]);
    const result = await service.findOrCreate(['无限流']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('无限流');
  });

  it('findOrCreate 应该创建缺失的标签', async () => {
    mockPrisma.topicTag.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 't1', name: '新标签', isActive: true }]);
    mockPrisma.topicTag.createMany.mockResolvedValue({});
    const result = await service.findOrCreate([' 新标签 ', '新标签']);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('新标签');
    expect(mockPrisma.topicTag.createMany).toHaveBeenCalledWith({
      data: [{ name: '新标签' }],
      skipDuplicates: true,
    });
  });

  it('findOrCreate 在事务客户端中创建标签，不会提前失效全局缓存', async () => {
    const tx = {
      topicTag: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 't1', name: '新标签', isActive: true }]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await expect(
      service.findOrCreate(['新标签'], tx as unknown as Prisma.TransactionClient),
    ).resolves.toHaveLength(1);

    expect(tx.topicTag.createMany).toHaveBeenCalledWith({
      data: [{ name: '新标签' }],
      skipDuplicates: true,
    });
    expect(mockCache.del).not.toHaveBeenCalled();
  });

  it('findOrCreate 在服务层拒绝非法标签，避免内部调用绕过 DTO', async () => {
    await expect(service.findOrCreate(['bad tag'])).rejects.toMatchObject({
      errorCode: ErrorCode.VALIDATION_ERROR,
    });
    expect(mockPrisma.topicTag.findMany).not.toHaveBeenCalled();
  });

  it('findOrCreate 不应该重新启用已停用标签', async () => {
    mockPrisma.topicTag.findMany.mockResolvedValue([{ id: 't1', name: '已停用', isActive: false }]);
    await expect(service.findOrCreate(['已停用'])).rejects.toMatchObject({
      errorCode: ErrorCode.TAXONOMY_STATE_CONFLICT,
    });
    expect(mockPrisma.topicTag.createMany).not.toHaveBeenCalled();
  });
});
