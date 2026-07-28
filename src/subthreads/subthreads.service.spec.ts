import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubthreadsService } from './subthreads.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { BusinessException } from '../common/exceptions/business.exception';

const mockPrisma = {
  $transaction: jest.fn(),
  thread: {
    findUnique: jest.fn(),
  },
  subthread: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  post: {
    create: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
  },
};

const mockThreadAccess = { assertAccessible: jest.fn(), assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER' }) };
const mockEventEmitter = { emit: jest.fn() };

/** 创建事务 mock 的辅助函数 */
const createTxMock = (overrides: Record<string, any> = {}) => ({
  $queryRaw: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  post: { create: jest.fn().mockResolvedValue({ id: 'p1', floorNumber: 1, content: 'test' }) },
  subthread: {
    aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 's1', threadId: 't1', sortOrder: 1 }),
    findUnique: jest.fn().mockResolvedValue({ id: 's1', threadId: 't1', tags: [], _count: { posts: 1 } }),
    update: jest.fn().mockResolvedValue({}),
    ...overrides,
  },
});

describe('SubthreadsService', () => {
  let service: SubthreadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubthreadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ThreadAccessService, useValue: mockThreadAccess },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();
    service = module.get<SubthreadsService>(SubthreadsService);
    jest.resetAllMocks();
    mockPrisma.thread.findUnique.mockResolvedValue({ visibility: 'PUBLIC', published: true, ownerId: 'u1' });
  });

  describe('create', () => {
    it('创建子贴并自动分配 sortOrder', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: true, title: '主题A' });
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(createTxMock()));

      const result = await service.create('t1', { title: '设定区', content: '正文' }, 'u1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('s1');
    });

    it('正文为空时仅创建子贴不创建楼层', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: true, title: '主题A' });
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(createTxMock({
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 1 } }),
        create: jest.fn().mockResolvedValue({ id: 's2', threadId: 't1', sortOrder: 2 }),
        findUnique: jest.fn().mockResolvedValue({ id: 's2', threadId: 't1', tags: [], _count: { posts: 0 } }),
      })));

      const result = await service.create('t1', { title: '空白区' }, 'u1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('s2');
    });

    it('指定 sortOrder 冲突应返回409', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: true, title: '主题A' });
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = createTxMock({
          findFirst: jest.fn().mockResolvedValue({ id: 'existing', sortOrder: 2 }),
        });
        return fn(tx);
      });

      await expect(
        service.create('t1', { title: '设定区', sortOrder: 2, content: '正文' }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('update', () => {
    it('默认子贴不可修改 sortOrder', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.subthread.findFirst.mockResolvedValue({ id: 's1' });

      await expect(
        service.update('s1', { version: 1, sortOrder: 5 }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('remove', () => {
    it('remove 应设置 deletedAt 而非硬删除', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', deletedAt: null });
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.subthread.findFirst.mockResolvedValue({ id: 's0' }); // 默认子贴是 s0，不是 s1
      mockPrisma.subthread.update.mockResolvedValue({ id: 's1', deletedAt: new Date() });
      await service.remove('s1', 'u1');
      expect(mockPrisma.subthread.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null, id: 's1' }, data: { deletedAt: expect.any(Date) } }),
      );
    });

    it('remove 已软删除的子贴应返回404', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue(null);
      await expect(service.remove('s1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('默认子贴不可删除', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', deletedAt: null });
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.subthread.findFirst.mockResolvedValue({ id: 's1' });

      await expect(service.remove('s1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('非默认子贴可正常删除', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's2', threadId: 't1', deletedAt: null });
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.subthread.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.subthread.update.mockResolvedValue({ id: 's2', deletedAt: new Date() });

      await service.remove('s2', 'u1');
      expect(mockPrisma.subthread.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null, id: 's2' } }),
      );
    });
  });

  describe('reorder', () => {
    it('批量重排应成功', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.subthread.findMany
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) // 验证存在
        .mockResolvedValueOnce([                                       // 返回结果
          { id: 'a', title: 'sA', sortOrder: 0 },
          { id: 'b', title: 'sB', sortOrder: 1 },
          { id: 'c', title: 'sC', sortOrder: 2 },
        ]);
      mockPrisma.subthread.findFirst.mockResolvedValue({ id: 'a' }); // 默认子贴
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        const tx = { subthread: { update: jest.fn() } };
        return fn(tx);
      });

      const result = await service.reorder('t1', ['a', 'b', 'c'], 'u1');
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('a');
    });

    it('空列表应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      await expect(service.reorder('t1', [], 'u1')).rejects.toThrow(BusinessException);
    });

    it('首项不是默认子贴应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.subthread.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      mockPrisma.subthread.findFirst.mockResolvedValue({ id: 'a' }); // 默认是 a，但请求首项是 b

      await expect(
        service.reorder('t1', ['b', 'a'], 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('列表含不存在的子贴应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.subthread.findMany.mockResolvedValue([{ id: 'a' }]); // 只有 a，但请求含 b

      await expect(
        service.reorder('t1', ['a', 'b'], 'u1'),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('find', () => {
    it('findAll 应过滤已软删除的子贴', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PUBLIC', published: true, ownerId: 'u1' });
      mockPrisma.subthread.findMany.mockResolvedValue([]);
      await service.findAll('t1');
      expect(mockPrisma.subthread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { threadId: 't1', deletedAt: null } }),
      );
    });

    it('findById 应返回子贴详情', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ visibility: 'PUBLIC', published: true, ownerId: 'u1' });
      mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', thread: { id: 't1', visibility: 'PUBLIC', ownerId: 'u1', published: true } });
      const result = await service.findById('s1');
      expect(result.id).toBe('s1');
    });

    it('findById 不存在应返回404', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toThrow(BusinessException);
    });
  });
});