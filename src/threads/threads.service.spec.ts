import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ThreadsService } from './threads.service';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { BlockFilterService } from '../common/services/block-filter.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

const mockPrisma = {
  $transaction: jest.fn(),
  thread: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn(),
  },
  subthread: {
    findFirst: jest.fn(),
  },
  threadTopicTag: {
    createMany: jest.fn(),
  },
  userFollow: {
    findMany: jest.fn(),
  },
  threadInvite: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  post: {
    findMany: jest.fn().mockResolvedValue([]),
  },
};

const mockTags = { findOrCreate: jest.fn() };
const mockThreadAccess = { assertAccessible: jest.fn(), assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER' }) };
const mockBlockFilter = {
  loadBlockSets: jest.fn().mockResolvedValue({ blockedByUser: new Set(), blockedByAuthor: new Set() }),
  filterRecipients: jest.fn((ids: string[]) => ids),
};
const mockNotificationProducer = { notify: jest.fn().mockResolvedValue(undefined) };
const mockEventEmitter = { emit: jest.fn() };
const mockRedis = { hincrby: jest.fn().mockResolvedValue(1), hset: jest.fn().mockResolvedValue(1), hdelAll: jest.fn().mockResolvedValue(1), zadd: jest.fn().mockResolvedValue(1), zrem: jest.fn().mockResolvedValue(1), zrevrange: jest.fn().mockResolvedValue([]), zcard: jest.fn().mockResolvedValue(100) };
const mockCache = { buildKey: jest.fn((...parts: string[]) => parts.join(':')), get: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined), delByPattern: jest.fn().mockResolvedValue(undefined) };

describe('ThreadsService', () => {
  let service: ThreadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TagsService, useValue: mockTags },
        { provide: ThreadAccessService, useValue: mockThreadAccess },
        { provide: BlockFilterService, useValue: mockBlockFilter },
        { provide: NotificationProducer, useValue: mockNotificationProducer },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: RedisService, useValue: mockRedis },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get<ThreadsService>(ThreadsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('创建草稿帖，不通知粉丝', async () => {
      const threadId = 't1';
      mockPrisma.$transaction.mockImplementation(async (fn) => fn({
        thread: {
          create: jest.fn().mockResolvedValue({ id: threadId }),
          update: jest.fn().mockResolvedValue({}),
        },
        threadMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
        subthread: {
          create: jest.fn().mockResolvedValue({ id: 's1', threadId }),
          update: jest.fn().mockResolvedValue({}),
        },
        post: { create: jest.fn().mockResolvedValue({ id: 'p1' }) },
      }));
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: threadId, title: '测试', category: 'RPG', ownerId: 'u1', published: false,
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [], topicTags: [], _count: { members: 1, posts: 0 },
      });

      const result = await service.create({ title: '测试', category: 'RPG' }, 'u1');
      expect(result).toBeDefined();
      expect(mockNotificationProducer.notify).not.toHaveBeenCalled();
    });

    it('无标题时 title 默认为未命名草稿', async () => {
      const threadId = 't1';
      let capturedThreadData: any;
      mockPrisma.$transaction.mockImplementation(async (fn) => fn({
        thread: {
          create: jest.fn().mockImplementation((args: any) => { capturedThreadData = args; return { id: threadId }; }),
          update: jest.fn().mockResolvedValue({}),
        },
        threadMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
        subthread: {
          create: jest.fn().mockResolvedValue({ id: 's1', threadId }),
          update: jest.fn().mockResolvedValue({}),
        },
        post: { create: jest.fn().mockResolvedValue({ id: 'p1' }) },
      }));
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: threadId, title: '未命名草稿', category: 'DEDUCTION', published: false,
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [], topicTags: [], _count: { members: 1, posts: 0 },
      });

      await service.create({}, 'u1');
      expect(capturedThreadData.data.title).toBe('未命名草稿');
    });
  });

  describe('findDrafts', () => {
    it('返回用户的未发布帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      const result = await service.findDrafts('u1');
      expect(result).toHaveLength(2);
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'u1', published: false, deletedAt: null } }),
      );
    });
  });

  describe('findAll', () => {
    it('只展示已发布帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);
      await service.findAll({ sort: 'newest' } as any);
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ published: true }) }),
      );
    });

    it('优先排列置顶帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);
      await service.findAll({ sort: 'newest' } as any);
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] }),
      );
    });

    describe('recommended（智能排序）', () => {
      const mkThread = (id: string) => ({
        id, title: id, category: 'RPG', published: true, visibility: 'PUBLIC',
        owner: { id: 'u1', username: 'u', avatar: null },
        defaultSubthread: { id: `s-${id}`, title: id, posts: [] },
        topicTags: [], _count: { members: 1, posts: 0 },
      });

      beforeEach(() => {
        mockRedis.zcard.mockResolvedValue(137);
        mockRedis.zrevrange.mockReset();
        mockRedis.zrevrange.mockResolvedValue([]);
        mockPrisma.thread.findMany.mockReset();
        // attachPlayerCounts 依赖 threadMember.groupBy
        mockPrisma.threadMember.groupBy.mockResolvedValue([]);
      });

      it('ZSET 前缀 + 可见帖累进切片，相邻页不重复', async () => {
        // 模拟：ZSET 前缀（混合分类），SQL 过滤后仅 3 篇 RPG 可见，且分散在 ZSET 中
        const rpgIds = ['r1', 'r2', 'r3'];
        mockRedis.zrevrange.mockResolvedValue([...rpgIds, 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']);
        mockPrisma.thread.findMany.mockResolvedValue([
          mkThread('r1'), mkThread('r2'), mkThread('r3'),
        ]);

        // 第 1 页：consumed=0，切片前 2 个
        const page1 = await service.findAll({ sort: 'recommended', category: 'RPG', limit: 2 } as any);
        expect(page1.items.map(t => t.id)).toEqual(['r1', 'r2']);
        expect(page1.pagination.hasMore).toBe(true);
        expect(page1.pagination.cursor).toBe('2');

        // 第 2 页：consumed=2，切片 [2,4)，只返回 r3，不重复
        const page2 = await service.findAll({ sort: 'recommended', category: 'RPG', limit: 2, cursor: '2' } as any);
        expect(page2.items.map(t => t.id)).toEqual(['r3']);
        expect(page2.pagination.hasMore).toBe(false);
        expect(page2.pagination.cursor).toBeNull();

        // 两页合并无重复
        const merged = [...page1.items, ...page2.items].map(t => t.id);
        expect(new Set(merged).size).toBe(merged.length);
      });

      it('过滤损耗大时扩大前缀扫描直至取够可见帖', async () => {
        const rpgIds = ['r1', 'r2', 'r3'];
        // 第一次前缀只含 1 篇 RPG（不够 consumed+take），第二次扩大后含 3 篇
        mockRedis.zrevrange
          .mockResolvedValueOnce(['r1', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'])
          .mockResolvedValueOnce([...rpgIds, 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7']);
        mockPrisma.thread.findMany
          .mockResolvedValueOnce([mkThread('r1')])
          .mockResolvedValueOnce([mkThread('r1'), mkThread('r2'), mkThread('r3')]);

        const page = await service.findAll({ sort: 'recommended', category: 'RPG', limit: 2 } as any);
        expect(mockRedis.zrevrange).toHaveBeenCalledTimes(2);
        expect(page.items.map(t => t.id)).toEqual(['r1', 'r2']);
        expect(page.pagination.cursor).toBe('2');
      });

      it('ZSET 为空时返回空页', async () => {
        mockRedis.zcard.mockResolvedValue(0);
        mockRedis.zrevrange.mockResolvedValue([]);
        const page = await service.findAll({ sort: 'recommended' } as any);
        expect(page.items).toEqual([]);
        expect(page.pagination.hasMore).toBe(false);
      });

      it('未登录 playing 筛选返回空', async () => {
        const page = await service.findAll({ sort: 'recommended', filter: 'playing' } as any);
        expect(page.items).toEqual([]);
        expect(mockPrisma.thread.findMany).not.toHaveBeenCalled();
      });

      it('playing 筛选排除自己创建的帖', async () => {
        mockPrisma.thread.findMany.mockResolvedValue([]);
        mockPrisma.threadMember.groupBy.mockResolvedValue([]);
        await service.findAll({ sort: 'newest', filter: 'playing' } as any, 'u1');
        const args = mockPrisma.thread.findMany.mock.calls[0][0];
        expect(args.where.members).toEqual({ some: { userId: 'u1', playerMarked: true } });
        expect(args.where.ownerId).toEqual({ not: 'u1' });
      });
    });
  });

  describe('findById', () => {
    it('已发布公开帖正常返回并递增 viewCount', async () => {
      const thread = { id: 't1', title: '测试', published: true, visibility: 'PUBLIC', owner: { id: 'u1' }, subthreads: [] };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.thread.update.mockResolvedValue({});
      const result = await service.findById('t1');
      expect(result.id).toBe('t1');
      expect(mockPrisma.thread.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { viewCount: { increment: 1 } },
      });
    });

    it('详情合并玩家计数 _count.players（playerMarked=true）', async () => {
      const thread = { id: 't1', title: '测试', published: true, visibility: 'PUBLIC', owner: { id: 'u1' }, subthreads: [], _count: { members: 5, posts: 3 } as any };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.thread.update.mockResolvedValue({});
      mockPrisma.threadMember.groupBy.mockResolvedValue([{ threadId: 't1', _count: 2 }]);

      const result = await service.findById('t1');
      expect((result._count as any).players).toBe(2);
      expect((result._count as any).members).toBe(5); // 候选池总数保留
      expect(mockPrisma.threadMember.groupBy).toHaveBeenCalledWith({
        by: ['threadId'],
        where: { threadId: { in: ['t1'] }, playerMarked: true },
        _count: true,
      });
    });

    it('无玩家标记成员时 _count.players 为 0', async () => {
      const thread = { id: 't1', title: '测试', published: true, visibility: 'PUBLIC', owner: { id: 'u1' }, subthreads: [], _count: { members: 5, posts: 3 } as any };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.thread.update.mockResolvedValue({});
      mockPrisma.threadMember.groupBy.mockResolvedValue([]);

      const result = await service.findById('t1');
      expect((result._count as any).players).toBe(0);
    });

    it('不存在返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toThrow(BusinessException);
    });

    it('未发布帖：owner 可查看', async () => {
      const thread = { id: 't1', title: '草稿', published: false, ownerId: 'u1', visibility: 'PUBLIC', owner: { id: 'u1' }, subthreads: [] };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      const result = await service.findById('t1', 'u1');
      expect(result.id).toBe('t1');
    });

    it('未发布帖：非 owner 返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', published: false, ownerId: 'u1', visibility: 'PUBLIC' });
      mockThreadAccess.assertAccessible.mockRejectedValueOnce(new BusinessException(ErrorCode.FORBIDDEN, ''));
      await expect(service.findById('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('未发布帖：未登录返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', published: false, ownerId: 'u1', visibility: 'PUBLIC' });
      mockThreadAccess.assertAccessible.mockRejectedValueOnce(new BusinessException(ErrorCode.FORBIDDEN, ''));
      await expect(service.findById('t1')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖非成员应返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', published: true, visibility: 'PRIVATE' });
      mockPrisma.threadMember.findUnique.mockResolvedValue(null);
      mockPrisma.thread.update.mockResolvedValue({});
      mockThreadAccess.assertAccessible.mockRejectedValueOnce(new BusinessException(ErrorCode.FORBIDDEN, ''));
      await expect(service.findById('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖成员应正常返回', async () => {
      const thread = { id: 't1', title: '私密帖', published: true, visibility: 'PRIVATE', owner: { id: 'u1' }, subthreads: [] };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      mockPrisma.thread.update.mockResolvedValue({});
      const result = await service.findById('t1', 'u3');
      expect(result.id).toBe('t1');
    });
  });

  describe('update', () => {
    it('修改标题应正常', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.update.mockResolvedValue({
        id: 't1', title: '新标题', owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [], topicTags: [], _count: { members: 1, posts: 0 },
      });
      const result = await service.update('t1', { version: 1, title: '新标题' }, 'u1');
      expect(result.title).toBe('新标题');
    });

    it('无权限返回403', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      mockThreadAccess.assertCanManage.mockRejectedValueOnce(new BusinessException(ErrorCode.FORBIDDEN, ''));
      await expect(service.update('t1', { version: 1, title: 'x' }, 'u2')).rejects.toThrow(BusinessException);
    });

    it('发布时应校验并通知粉丝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique
        .mockResolvedValueOnce({ published: false, title: '测试', category: 'RPG' })     // update() 初次查询
        .mockResolvedValueOnce({ defaultSubthread: { id: 's1', posts: [{ id: 'p1', kind: 'BODY' }] } }); // validatePublishReadiness
      mockPrisma.thread.update.mockResolvedValue({
        id: 't1', title: '测试', category: 'RPG', published: true,
        createdAt: new Date('2025-01-01'), updatedAt: new Date(),
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [], topicTags: [], _count: { members: 1, posts: 1 },
      });
      mockPrisma.userFollow.findMany.mockResolvedValue([{ followerId: 'f1' }]);

      const result = await service.update('t1', { version: 1, published: true }, 'u1');
      expect(result.published).toBe(true);
      expect(mockNotificationProducer.notify).toHaveBeenCalledWith(
        'thread_created',
        ['f1'],
        expect.any(String),
        expect.objectContaining({ threadId: 't1', fromUserId: 'u1' }),
      );
    });

    it('发布时无标题应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: false, title: '', category: 'DEDUCTION' });
      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(BusinessException);
    });

    it('发布时无子贴应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique
        .mockResolvedValueOnce({ published: false, title: '测试', category: 'RPG' })
        .mockResolvedValueOnce(null); // validatePublishReadiness 查不到默认子贴
      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(BusinessException);
    });

    it('发布时默认子贴无正文（kind=BODY posts 为空）应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique
        .mockResolvedValueOnce({ published: false, title: '测试', category: 'RPG' })
        .mockResolvedValueOnce({ defaultSubthread: { id: 's1', posts: [] } }); // validatePublishReadiness：无 BODY 正文
      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(BusinessException);
    });

    it('已发布的帖不能再发布', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: true, title: '测试', category: 'RPG' });
      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(BusinessException);
    });
  });

  describe('remove', () => {
    it('仅楼主可删除', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true });
      await expect(service.remove('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('已发布帖软删除', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true });
      mockPrisma.thread.update.mockResolvedValue({ id: 't1', deletedAt: new Date() });
      const result = await service.remove('t1', 'u1');
      expect(result.deletedAt).toBeDefined();
      expect(mockPrisma.thread.update).toHaveBeenCalled();
    });

    it('未发布草稿硬删除', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: false });
      mockPrisma.thread.delete.mockResolvedValue({ id: 't1' });
      await service.remove('t1', 'u1');
      expect(mockPrisma.thread.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });

  describe('assertCanManage', () => {
    it('OWNER 应该通过', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      await expect(service.assertCanManage('t1', 'u1')).resolves.toBeDefined();
    });

    it('COLLABORATOR 应该通过', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'COLLABORATOR' });
      await expect(service.assertCanManage('t1', 'u1')).resolves.toBeDefined();
    });

    it('PARTICIPANT 应该返回403', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      mockThreadAccess.assertCanManage.mockRejectedValueOnce(new BusinessException(ErrorCode.FORBIDDEN, ''));
      await expect(service.assertCanManage('t1', 'u1')).rejects.toThrow(BusinessException);
    });
  });

  describe('createInviteLink', () => {
    it('未发布帖禁止生成邀请链接', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: false, visibility: 'PRIVATE' });
      await expect(service.createInviteLink('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('公开帖禁止生成邀请链接', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true, visibility: 'PUBLIC' });
      await expect(service.createInviteLink('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('私密已发布帖正常生成', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true, visibility: 'PRIVATE' });
      mockPrisma.threadInvite.upsert.mockResolvedValue({ id: 'inv1', threadId: 't1', token: 'abc123' });
      const result = await service.createInviteLink('t1', 'u1');
      expect(result.token).toBeDefined();
    });
  });

  describe('previewInviteLink', () => {
    it('无效 token 返回 404', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue(null);
      await expect(service.previewInviteLink('invalid')).rejects.toThrow(BusinessException);
    });

    it('未发布帖禁止预览', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', title: 'test', category: 'RPG', status: 'RECRUITING', visibility: 'PRIVATE', published: false, deletedAt: null, createdAt: new Date(), owner: { id: 'u1', username: 'a', avatar: null } },
      });
      await expect(service.previewInviteLink('token123')).rejects.toThrow(BusinessException);
    });

    it('公开帖禁止通过邀请预览', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', title: 'test', category: 'RPG', status: 'RECRUITING', visibility: 'PUBLIC', published: true, deletedAt: null, createdAt: new Date(), owner: { id: 'u1', username: 'a', avatar: null } },
      });
      await expect(service.previewInviteLink('token123')).rejects.toThrow(BusinessException);
    });

    it('软删除帖禁止预览', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', title: 'test', category: 'RPG', status: 'RECRUITING', visibility: 'PRIVATE', published: true, deletedAt: new Date(), createdAt: new Date(), owner: { id: 'u1', username: 'a', avatar: null } },
      });
      await expect(service.previewInviteLink('token123')).rejects.toThrow(BusinessException);
    });

    it('正常预览私密帖', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', title: '奇幻大陆', category: 'RPG', status: 'RECRUITING', visibility: 'PRIVATE', published: true, deletedAt: null, createdAt: new Date(), owner: { id: 'u1', username: '张三', avatar: null } },
      });
      mockPrisma.threadMember.count.mockResolvedValue(5);
      const result = await service.previewInviteLink('token123');
      expect(result.thread.id).toBe('t1');
      expect(result.thread.title).toBe('奇幻大陆');
      expect(result.thread.category).toBe('RPG');
      expect(result.thread.status).toBe('RECRUITING');
      expect(result.thread.owner.username).toBe('张三');
      expect(result.thread.memberCount).toBe(5);
    });
  });

  describe('joinByInviteLink', () => {
    it('未发布帖禁止通过邀请加入', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1', thread: { id: 't1', visibility: 'PRIVATE', published: false },
      });
      await expect(service.joinByInviteLink('token123', 'u2')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖正常加入', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1', thread: { id: 't1', visibility: 'PRIVATE', published: true },
      });
      mockPrisma.threadMember.findUnique.mockResolvedValue(null);
      mockPrisma.threadMember.create.mockResolvedValue({ id: 'm1', thread: {}, user: {} });
      const result = await service.joinByInviteLink('token123', 'u2');
      expect(result.id).toBe('m1');
    });
  });

  describe('findByCreatedUser', () => {
    const mkThread = (id: string, visibility = 'PUBLIC') => ({
      id, title: id, category: 'RPG', published: true, visibility,
      owner: { id: 'u1', username: 'u', avatar: null },
      defaultSubthread: { id: `s-${id}`, title: id, lastPostAt: null },
      topicTags: [], _count: { members: 1, posts: 0 },
    });

    beforeEach(() => {
      mockPrisma.thread.findMany.mockReset();
      mockPrisma.threadMember.groupBy.mockResolvedValue([]);
    });

    it('本人查看返回全部已发布帖（含私密帖）', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([
        mkThread('t1', 'PUBLIC'), mkThread('t2', 'PRIVATE'),
      ]);
      const page = await service.findByCreatedUser('u1', 'u1');
      const args = mockPrisma.thread.findMany.mock.calls[0][0];
      expect(args.where.ownerId).toBe('u1');
      expect(args.where.published).toBe(true);
      expect(args.where.visibility).toBeUndefined();
      expect(page.items.map(t => t.id)).toEqual(['t1', 't2']);
    });

    it('他人查看仅返回 PUBLIC 已发布帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([mkThread('t1', 'PUBLIC')]);
      const page = await service.findByCreatedUser('u1', 'viewer');
      const args = mockPrisma.thread.findMany.mock.calls[0][0];
      expect(args.where.visibility).toBe('PUBLIC');
      expect(page.items.map(t => t.id)).toEqual(['t1']);
    });

    it('cursor 分页返回 hasMore 与下一页游标', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([mkThread('t1'), mkThread('t2'), mkThread('t3')]);
      const page = await service.findByCreatedUser('u1', 'u1', undefined, 2);
      expect(page.items.map(t => t.id)).toEqual(['t1', 't2']);
      expect(page.pagination.hasMore).toBe(true);
      expect(page.pagination.cursor).toBe('t2');
    });
  });

  describe('findByPlayedUser', () => {
    it('参与列表排除自己创建的帖（ownerId = targetId）', async () => {
      mockPrisma.threadMember.findMany.mockResolvedValue([
        { id: 'm1', thread: { id: 't1' } },
      ]);
      mockPrisma.threadMember.groupBy.mockResolvedValue([]);
      await service.findByPlayedUser('u1', 'u1');
      const args = mockPrisma.threadMember.findMany.mock.calls[0][0];
      expect(args.where.playerMarked).toBe(true);
      expect(args.where.thread.ownerId).toEqual({ not: 'u1' });
    });
  });
});
