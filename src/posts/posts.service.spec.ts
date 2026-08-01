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

const mockPrisma = {
  $transaction: jest.fn(),
  user: { findUnique: jest.fn() },
  thread: { findUnique: jest.fn() },
  subthread: { findUnique: jest.fn() },
  threadMember: { findUnique: jest.fn(), upsert: jest.fn() },
  post: { findUnique: jest.fn(), aggregate: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
};

const mockEventEmitter = { emit: jest.fn() };
const mockThreadAccess = { assertAccessible: jest.fn() };
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
      id: 'p1', floorNumber: 6, content: 'test', author: { username: 'test' },
    });
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p1', floorNumber: 6, content: 'test', author: { username: 'test' } }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    const result = await service.create('s1', { content: 'test' }, 'u1');
    expect(result.floorNumber).toBe(6);
  });

  it('create 非默认子贴首次发帖应回写 bodyPostId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
    const subthread = {
      id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS', bodyPostId: null,
      thread: { published: true, defaultSubthreadId: 's0' },
    };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.post.aggregate.mockResolvedValue({ _max: { floorNumber: 5 } });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p1', floorNumber: 6, content: 'test', author: { username: 'test' },
    });
    let tx: any;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p1', floorNumber: 6, content: 'test', author: { username: 'test' } }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    await service.create('s1', { content: 'test' }, 'u1');
    expect(tx.subthread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bodyPostId: 'p1' }) }),
    );
  });

  it('create 已有 bodyPost 的子贴再次发帖不应覆盖', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
    const subthread = {
      id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS', bodyPostId: 'existing',
      thread: { published: true, defaultSubthreadId: 's0' },
    };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.post.aggregate.mockResolvedValue({ _max: { floorNumber: 5 } });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p1', floorNumber: 6, content: 'test', author: { username: 'test' },
    });
    let tx: any;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p1', floorNumber: 6, content: 'test', author: { username: 'test' } }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    await service.create('s1', { content: 'test' }, 'u1');
    expect(tx.subthread.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bodyPostId: expect.anything() }) }),
    );
    expect(tx.subthread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastPostAt: expect.any(Date) }) }),
    );
  });

  it('create 楼中楼回复不应回写 bodyPostId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
    const subthread = {
      id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS', bodyPostId: null,
      thread: { published: true, defaultSubthreadId: 's0' },
    };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', subthreadId: 's1', parentPostId: null });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p2', floorNumber: null, parentPostId: 'p1', content: 'reply',
      author: { username: 'test' },
    });
    let tx: any;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p2', floorNumber: null, parentPostId: 'p1', content: 'reply', author: { username: 'test' } }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    await service.create('s1', { content: 'reply', parentPostId: 'p1' }, 'u1');
    expect(tx.subthread.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bodyPostId: expect.anything() }) }),
    );
  });

  it('create 楼中楼回复不应该有 floorNumber', async () => {
    const subthread = { id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS', thread: { published: true } };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', subthreadId: 's1', parentPostId: null });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p2', floorNumber: null, parentPostId: 'p1', content: 'reply',
      author: { username: 'test' },
    });
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p2', floorNumber: null, parentPostId: 'p1', content: 'reply', author: { username: 'test' } }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    const result = await service.create('s1', { content: 'reply', parentPostId: 'p1' }, 'u1');
    expect(result.floorNumber).toBeNull();
    expect(result.parentPostId).toBe('p1');
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
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u1', floorNumber: 3, parentPostId: 'p0', subthread: { deletedAt: null } });
    mockPrisma.post.update.mockResolvedValue({ id: 'p1', deletedAt: new Date() });
    await service.remove('p1', 'u1');
    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('remove 第一楼应该返回403', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u1', floorNumber: 1, parentPostId: null, subthread: { deletedAt: null } });
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
  });

  it('findAllBySubthread 无回复楼层应返回空 replies 数组', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p1', author: {}, _count: { replies: 0 } }]);
    const result = await service.findAllBySubthread('s1');
    expect((result.items[0] as any).replies).toEqual([]);
  });

  it('findReplies 应该返回楼中楼', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', threadId: 't1', subthread: { deletedAt: null } });
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p2', author: {}, replyToPost: null }]);
    const result = await service.findReplies('p1');
    expect(result.items[0].id).toBe('p2');
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
