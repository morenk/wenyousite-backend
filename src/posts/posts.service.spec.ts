import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { BlockFilterService } from '../common/services/block-filter.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { MentionsService } from '../mentions/mentions.service';
import { ReadingProgressService } from '../reading-progress/reading-progress.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

const mockPrisma = {
  $transaction: jest.fn(),
  user: { findUnique: jest.fn() },
  thread: { findUnique: jest.fn() },
  subthread: { findUnique: jest.fn(), update: jest.fn() },
  threadMember: { findUnique: jest.fn(), upsert: jest.fn() },
  post: { findUnique: jest.fn(), aggregate: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
};

const mockEventEmitter = { emit: jest.fn() };
const mockThreadAccess = { assertAccessible: jest.fn(), assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER' }) };
const mockNotificationProducer = { notify: jest.fn().mockResolvedValue(undefined) };
const mockMentions = { extractUsernames: jest.fn().mockReturnValue([]), parseAndCreate: jest.fn().mockResolvedValue([]) };
const mockReadingProgress = { update: jest.fn().mockResolvedValue(undefined) };
const mockRedis = { hincrby: jest.fn().mockResolvedValue(1), hgetall: jest.fn().mockResolvedValue({}), hset: jest.fn().mockResolvedValue(1), zadd: jest.fn().mockResolvedValue(1) };
const mockCache = { buildKey: jest.fn((...parts: string[]) => parts.join(':')), get: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined), delByPattern: jest.fn().mockResolvedValue(undefined) };

const mockBlockFilter = {
  loadBlockSets: jest.fn().mockResolvedValue({ blockedByUser: new Set(), blockedByAuthor: new Set() }),
  filterRecipients: jest.fn((ids: string[]) => ids),
};

describe('PostsService', () => {
  let service: PostsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ThreadAccessService, useValue: mockThreadAccess },
        { provide: BlockFilterService, useValue: mockBlockFilter },
        { provide: NotificationProducer, useValue: mockNotificationProducer },
        { provide: MentionsService, useValue: mockMentions },
        { provide: ReadingProgressService, useValue: mockReadingProgress },
        { provide: RedisService, useValue: mockRedis },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get<PostsService>(PostsService);
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
    mockPrisma.thread.findUnique.mockResolvedValue({ visibility: 'PUBLIC', published: true, ownerId: 'u1' });
  });

  it('create 新楼层应该正确分配 floorNumber', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
    const subthread = { id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS', thread: { published: true } };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.post.aggregate.mockResolvedValue({ _max: { floorNumber: 5 } });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p1', kind: 'FLOOR', floorNumber: 6, content: 'test', author: { username: 'test' },
    });
    let tx: any;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p1', kind: 'FLOOR', floorNumber: 6, content: 'test', author: { username: 'test' } }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    const result = await service.create('s1', { content: 'test' }, 'u1');
    expect(result.floorNumber).toBe(6);
    // 发帖事务只更新 lastPostAt，不再回写 bodyPostId
    expect(tx.subthread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastPostAt: expect.any(Date) } }),
    );
  });

  it('create 楼中楼回复不应该有 floorNumber', async () => {
    const subthread = { id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS', thread: { published: true } };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', subthreadId: 's1', parentPostId: null });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p2', kind: 'FLOOR', floorNumber: null, parentPostId: 'p1', content: 'reply',
      author: { username: 'test' },
    });
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p2', kind: 'FLOOR', floorNumber: null, parentPostId: 'p1', content: 'reply', author: { username: 'test' } }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    const result = await service.create('s1', { content: 'reply', parentPostId: 'p1' }, 'u1');
    expect(result.floorNumber).toBeNull();
    expect(result.parentPostId).toBe('p1');
  });

  describe('upsertBody', () => {
    it('无正文时创建 kind=BODY 正文帖并更新 lastPostAt、发 post.created 事件', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({
        id: 's1', threadId: 't1', title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockPrisma.post.findFirst.mockResolvedValue(null);
      mockPrisma.post.create.mockResolvedValue({
        id: 'b1', kind: 'BODY', floorNumber: null, version: 1, author: { username: 'u' },
      });
      mockPrisma.subthread.update.mockResolvedValue({});

      const result = await service.upsertBody('s1', '新正文', undefined, 'u1');
      expect(result.id).toBe('b1');
      expect(result.kind).toBe('BODY');
      expect(result.floorNumber).toBeNull();
      expect(mockPrisma.subthread.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1' }, data: { lastPostAt: expect.any(Date) } }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'post.created',
        expect.objectContaining({ postId: 'b1', isSubthreadBody: true }),
      );
    });

    it('更新已有正文（乐观锁 version 匹配）', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({
        id: 's1', threadId: 't1', title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockPrisma.post.findFirst.mockResolvedValue({ id: 'b1', content: '旧', version: 2, kind: 'BODY' });
      mockPrisma.post.update.mockResolvedValue({
        id: 'b1', content: '新', version: 3, kind: 'BODY', parentPostId: null, author: { username: 'u' },
      });

      const result = await service.upsertBody('s1', '新', 2, 'u1');
      expect(result.content).toBe('新');
      expect(mockPrisma.post.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'b1', version: 2 }),
          data: expect.objectContaining({ content: '新', version: { increment: 1 } }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'post.updated',
        expect.objectContaining({ postId: 'b1' }),
      );
    });

    it('version 不匹配应返回 409（OPTIMISTIC_LOCK_CONFLICT）', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({
        id: 's1', threadId: 't1', title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockPrisma.post.findFirst.mockResolvedValue({ id: 'b1', content: '旧', version: 2, kind: 'BODY' });

      const err = await service.upsertBody('s1', '新', 1, 'u1').catch((e) => e);
      expect(err).toBeInstanceOf(BusinessException);
      expect((err as BusinessException).errorCode).toBe(ErrorCode.OPTIMISTIC_LOCK_CONFLICT);
    });

    it('非管理者应返回 403', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({
        id: 's1', threadId: 't1', title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockThreadAccess.assertCanManage.mockRejectedValueOnce(
        new BusinessException(ErrorCode.FORBIDDEN, '无管理权限'),
      );

      await expect(service.upsertBody('s1', '新', undefined, 'u2')).rejects.toThrow(BusinessException);
    });
  });

  it('create COLLABORATORS 权限子贴非协作者应该返回403', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1', threadId: 't1', postingPolicy: 'COLLABORATORS',
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    await expect(service.create('s1', { content: 'test' }, 'u1')).rejects.toThrow(BusinessException);
  });

  it('create 不存在的父楼层应该返回404', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS' });
    mockPrisma.post.findUnique.mockResolvedValue(null);
    await expect(service.create('s1', { content: 'test', parentPostId: 'x' }, 'u1')).rejects.toThrow(BusinessException);
  });

  it('update 编辑自己的帖子应该成功', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u1', threadId: 't1', content: '旧内容', subthread: { deletedAt: null } });
    mockPrisma.post.update.mockResolvedValue({ id: 'p1', content: '编辑后', author: { username: 'test' } });
    const result = await service.update('p1', { version: 1, content: '编辑后' }, 'u1');
    expect(result.content).toBe('编辑后');
  });

  it('update 编辑他人的帖子应该返回403', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'other', subthread: { deletedAt: null } });
    await expect(service.update('p1', { version: 1, content: 'x' }, 'u1')).rejects.toThrow(BusinessException);
  });

  it('remove 软删除非第一楼应该成功', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u1', kind: 'FLOOR', floorNumber: 3, parentPostId: 'p0', threadId: 't1', subthread: { deletedAt: null } });
    mockPrisma.post.update.mockResolvedValue({ id: 'p1', deletedAt: new Date() });
    await service.remove('p1', 'u1');
    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('remove 正文帖（kind=BODY）应该返回403', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u1', kind: 'BODY', threadId: 't1', subthread: { deletedAt: null } });
    await expect(service.remove('p1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('create PLAYERS 权限非玩家应该返回403', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1', threadId: 't1', postingPolicy: 'PLAYERS',
    });
    mockPrisma.threadMember.upsert.mockResolvedValue({});
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT', playerMarked: false });
    await expect(service.create('s1', { content: 'test' }, 'u1')).rejects.toThrow(BusinessException);
  });

  it('findAllBySubthread 应该返回楼层及内嵌前 3 条楼中楼回复', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
    mockPrisma.post.findMany
      .mockResolvedValueOnce([{ id: 'p1', author: {}, _count: { replies: 2 } }])
      .mockResolvedValueOnce([
        { id: 'r1', author: {}, replyToPost: null },
        { id: 'r2', author: {}, replyToPost: null },
      ]);
    const result = await service.findAllBySubthread('s1');
    expect((result.items[0] as any).replies).toHaveLength(2);
    // 楼层查询 where 只包含 kind=FLOOR
    expect(mockPrisma.post.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ kind: 'FLOOR', parentPostId: null }),
    }));
  });

  it('findAllBySubthread 无回复楼层应返回空 replies 数组', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p1', author: {}, _count: { replies: 0 } }]);
    const result = await service.findAllBySubthread('s1');
    expect((result.items[0] as any).replies).toEqual([]);
  });

  it('findReplies 应该返回楼中楼', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1', threadId: 't1', kind: 'FLOOR', parentPostId: null, subthread: { deletedAt: null },
    });
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p2', author: {}, replyToPost: null }]);
    const result = await service.findReplies('p1');
    expect(result.items[0].id).toBe('p2');
    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));
  });

  it('findReplies 拒绝以楼中楼回复作为讨论根', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p2', threadId: 't1', kind: 'FLOOR', parentPostId: 'p1', subthread: { deletedAt: null },
    });

    await expect(service.findReplies('p2')).rejects.toThrow(BusinessException);
    expect(mockPrisma.post.findMany).not.toHaveBeenCalled();
  });

  it('findById 应该返回帖子详情', async () => {
    mockPrisma.post.findUnique
      .mockResolvedValueOnce({ id: 'p1', threadId: 't1', subthread: { deletedAt: null } })
      .mockResolvedValueOnce({
        id: 'p1', author: {}, thread: {}, subthread: {}, parentPost: null, _count: { replies: 0 },
      });
    const result = await service.findById('p1');
    expect(result.id).toBe('p1');
  });
});
