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
import { DiceService } from '../dice/dice.service';

const mockPrisma = {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  user: { findUnique: jest.fn() },
  thread: { findUnique: jest.fn() },
  subthread: { findUnique: jest.fn(), update: jest.fn() },
  threadMember: { findUnique: jest.fn(), upsert: jest.fn() },
  post: {
    findUnique: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  diceRoll: { createMany: jest.fn(), deleteMany: jest.fn() },
};

const mockEventEmitter = { emit: jest.fn() };
const mockThreadAccess = {
  assertAccessible: jest.fn(),
  assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER' }),
};
const mockNotificationProducer = { notify: jest.fn().mockResolvedValue(undefined) };
const mockMentions = {
  extractUsernames: jest.fn().mockReturnValue([]),
  parseAndCreate: jest.fn().mockResolvedValue([]),
  syncMentions: jest.fn().mockResolvedValue([]),
};
const mockReadingProgress = { update: jest.fn().mockResolvedValue(undefined) };
const mockRedis = {
  hincrby: jest.fn().mockResolvedValue(1),
  hgetall: jest.fn().mockResolvedValue({}),
  hset: jest.fn().mockResolvedValue(1),
  zadd: jest.fn().mockResolvedValue(1),
};
const mockCache = {
  buildKey: jest.fn((...parts: string[]) => parts.join(':')),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delByPattern: jest.fn().mockResolvedValue(undefined),
};

const mockBlockFilter = {
  loadBlockSets: jest
    .fn()
    .mockResolvedValue({ blockedByUser: new Set(), blockedByAuthor: new Set() }),
  filterRecipients: jest.fn((ids: string[]) => ids),
};

describe('PostsService', () => {
  let service: PostsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        DiceService,
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
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));
    mockPrisma.post.findUniqueOrThrow.mockImplementation(async () => {
      const updateResult = mockPrisma.post.update.mock.results.at(-1)?.value;
      if (updateResult) return updateResult;
      return mockPrisma.post.create.mock.results.at(-1)?.value;
    });
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
    mockPrisma.thread.findUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      published: true,
      ownerId: 'u1',
    });
  });

  it('create 新楼层应该正确分配 floorNumber', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
    const subthread = {
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true },
    };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.post.aggregate.mockResolvedValue({ _max: { floorNumber: 5 } });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p1',
      kind: 'FLOOR',
      floorNumber: 6,
      content: 'test',
      author: { username: 'test' },
    });
    let tx: any;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest
            .fn()
            .mockResolvedValue({
              id: 'p1',
              kind: 'FLOOR',
              floorNumber: 6,
              content: 'test',
              author: { username: 'test' },
            }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    const result = await service.create('s1', { content: 'test' }, 'u1');
    expect(result.floorNumber).toBe(6);
    // 发帖事务更新子贴和主题帖的最近活动时间，不再回写 bodyPostId
    expect(tx.subthread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastPostAt: expect.any(Date),
          thread: {
            update: { data: { updatedAt: expect.any(Date) } },
          },
        }),
      }),
    );
  });

  it('create 应规范化正文后再存库并发事件', async () => {
    const subthread = {
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true },
    };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    let tx: any;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 0 } }),
          create: jest.fn().mockResolvedValue({
            id: 'p1',
            kind: 'FLOOR',
            floorNumber: 1,
            content: '第一段\n<br />\n',
            author: { username: 'test' },
          }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    await service.create('s1', { content: '第一段\r\n<br>\r\n![空]()' }, 'u1');

    expect(tx.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: '第一段\n<br />\n' }),
      }),
    );
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'post.created',
      expect.objectContaining({ content: '第一段\n<br />\n' }),
    );
  });

  it('create 应允许只包含 CommonMark 自动链接的回复', async () => {
    const content = '<https://wenyou.site/threads/example>';
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true },
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.$transaction.mockImplementation(async (fn) =>
      fn({
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 0 } }),
          create: jest.fn().mockResolvedValue({
            id: 'p1',
            kind: 'FLOOR',
            floorNumber: 1,
            content,
            author: { username: 'test' },
          }),
        },
        subthread: { update: jest.fn() },
      }),
    );

    await expect(service.create('s1', { content }, 'u1')).resolves.toMatchObject({ content });
  });

  it('已发布楼层可只提交骰子，并在同一事务保存服务端正式结果', async () => {
    const nodeId = '550e8400-e29b-41d4-a716-446655440000';
    const content = `[[dice:v1:${nodeId}:2D6 + 3]]`;
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      title: '主帖',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true },
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    const created = {
      id: 'p-dice',
      kind: 'FLOOR',
      floorNumber: 1,
      content: `[[dice:v1:${nodeId}:2d6+3]]`,
      author: { username: 'test' },
    };
    const official = {
      ...created,
      diceRolls: [{ id: 'r1', nodeId, notation: '2d6+3', results: [2, 5], modifier: 3, total: 10 }],
    };
    const tx = {
      $queryRaw: jest.fn(),
      post: {
        aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 0 } }),
        create: jest.fn().mockResolvedValue(created),
        findUniqueOrThrow: jest.fn().mockResolvedValue(official),
      },
      diceRoll: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      subthread: { update: jest.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(tx));

    const result = await service.create('s1', { content }, 'u1');

    expect(tx.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: `[[dice:v1:${nodeId}:2d6+3]]` }),
      }),
    );
    expect(tx.diceRoll.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          postId: 'p-dice',
          nodeId,
          notation: '2d6+3',
          quantity: 2,
          sides: 6,
          modifier: 3,
        }),
      ],
    });
    expect(result.diceRolls).toEqual(official.diceRolls);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'post.created',
      expect.objectContaining({ diceRolls: official.diceRolls }),
    );
  });

  it('相同 clientRequestId 重试应返回首次帖子且不重复事务和事件', async () => {
    const subthread = {
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true },
    };
    const existing = {
      id: 'p1',
      subthreadId: 's1',
      authorId: 'u1',
      content: '相同正文',
      parentPostId: null,
      replyToPostId: null,
      clientRequestId: '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77',
      author: { username: 'test' },
    };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.post.findFirst.mockResolvedValue(existing);

    const result = await service.create(
      's1',
      {
        content: '相同正文',
        clientRequestId: existing.clientRequestId,
      },
      'u1',
    );

    expect(result).toBe(existing);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('同一 clientRequestId 复用为不同正文应返回 409', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true },
    });
    mockPrisma.post.findFirst.mockResolvedValue({
      id: 'p1',
      subthreadId: 's1',
      authorId: 'u1',
      content: '旧正文',
      parentPostId: null,
      replyToPostId: null,
      author: { username: 'test' },
    });

    await expect(
      service.create(
        's1',
        {
          content: '不同正文',
          clientRequestId: '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77',
        },
        'u1',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('并发请求唯一键竞争失败时应读取胜方结果且不重复发事件', async () => {
    const requestId = '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77';
    const existing = {
      id: 'p1',
      subthreadId: 's1',
      authorId: 'u1',
      content: '并发正文',
      parentPostId: null,
      replyToPostId: null,
      clientRequestId: requestId,
      author: { username: 'test' },
    };
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true },
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.post.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    mockPrisma.$transaction.mockRejectedValue({ code: 'P2002' });

    const result = await service.create(
      's1',
      { content: '并发正文', clientRequestId: requestId },
      'u1',
    );

    expect(result).toBe(existing);
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    expect(mockReadingProgress.update).not.toHaveBeenCalled();
  });

  it('create 楼中楼回复不应该有 floorNumber', async () => {
    const subthread = {
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true },
    };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      subthreadId: 's1',
      parentPostId: null,
    });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p2',
      kind: 'FLOOR',
      floorNumber: null,
      parentPostId: 'p1',
      content: 'reply',
      author: { username: 'test' },
    });
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest
            .fn()
            .mockResolvedValue({
              id: 'p2',
              kind: 'FLOOR',
              floorNumber: null,
              parentPostId: 'p1',
              content: 'reply',
              author: { username: 'test' },
            }),
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
        id: 's1',
        threadId: 't1',
        title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockPrisma.post.findFirst.mockResolvedValue(null);
      mockPrisma.post.create.mockResolvedValue({
        id: 'b1',
        kind: 'BODY',
        floorNumber: null,
        version: 1,
        author: { username: 'u' },
      });
      mockPrisma.subthread.update.mockResolvedValue({});

      const result = await service.upsertBody('s1', '新正文', undefined, 'u1');
      expect(result.id).toBe('b1');
      expect(result.kind).toBe('BODY');
      expect(result.floorNumber).toBeNull();
      expect(mockPrisma.subthread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's1' },
          data: expect.objectContaining({
            lastPostAt: expect.any(Date),
            thread: {
              update: { data: { updatedAt: expect.any(Date) } },
            },
          }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'post.created',
        expect.objectContaining({ postId: 'b1', isSubthreadBody: true }),
      );
    });

    it('更新已有正文（乐观锁 version 匹配）', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({
        id: 's1',
        threadId: 't1',
        title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockPrisma.post.findFirst.mockResolvedValue({
        id: 'b1',
        content: '旧',
        version: 2,
        kind: 'BODY',
      });
      mockPrisma.post.update.mockResolvedValue({
        id: 'b1',
        content: '新',
        version: 3,
        kind: 'BODY',
        parentPostId: null,
        author: { username: 'u' },
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

    it('upsertBody 应将规范化正文用于更新和提及同步', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({
        id: 's1',
        threadId: 't1',
        title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockPrisma.post.findFirst.mockResolvedValue({
        id: 'b1',
        content: '旧',
        version: 2,
        kind: 'BODY',
      });
      mockPrisma.post.update.mockResolvedValue({
        id: 'b1',
        content: '新\n<br />',
        version: 3,
        kind: 'BODY',
        parentPostId: null,
        author: { username: 'u' },
      });

      await service.upsertBody('s1', '新\r\n<br>', 2, 'u1');

      expect(mockPrisma.post.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ content: '新\n<br />' }),
        }),
      );
      expect(mockMentions.syncMentions).toHaveBeenCalledWith('b1', '新\n<br />', 'u1', 't1', '旧');
    });

    it('version 不匹配应返回 409（OPTIMISTIC_LOCK_CONFLICT）', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({
        id: 's1',
        threadId: 't1',
        title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockPrisma.post.findFirst.mockResolvedValue({
        id: 'b1',
        content: '旧',
        version: 2,
        kind: 'BODY',
      });

      const err = await service.upsertBody('s1', '新', 1, 'u1').catch((e) => e);
      expect(err).toBeInstanceOf(BusinessException);
      expect((err as BusinessException).errorCode).toBe(ErrorCode.OPTIMISTIC_LOCK_CONFLICT);
    });

    it('非管理者应返回 403', async () => {
      mockPrisma.subthread.findUnique.mockResolvedValue({
        id: 's1',
        threadId: 't1',
        title: 'x',
        thread: { id: 't1', published: true, title: 'x' },
      });
      mockThreadAccess.assertCanManage.mockRejectedValueOnce(
        new BusinessException(ErrorCode.FORBIDDEN, '无管理权限'),
      );

      await expect(service.upsertBody('s1', '新', undefined, 'u2')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  it('create COLLABORATORS 权限子贴非协作者应该返回403', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      postingPolicy: 'COLLABORATORS',
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    await expect(service.create('s1', { content: 'test' }, 'u1')).rejects.toThrow(
      BusinessException,
    );
  });

  it('create 不存在的父楼层应该返回404', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PARTICIPANTS',
    });
    mockPrisma.post.findUnique.mockResolvedValue(null);
    await expect(
      service.create('s1', { content: 'test', parentPostId: 'x' }, 'u1'),
    ).rejects.toThrow(BusinessException);
  });

  it('update 编辑自己的帖子应该成功', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'u1',
      threadId: 't1',
      content: '旧内容',
      subthread: { deletedAt: null },
    });
    mockPrisma.post.update.mockResolvedValue({
      id: 'p1',
      content: '编辑后',
      author: { username: 'test' },
    });
    const result = await service.update('p1', { version: 1, content: '编辑后' }, 'u1');
    expect(result.content).toBe('编辑后');
  });

  it('update 移动已结算骰子节点时保留原结果，不重掷', async () => {
    const nodeId = '550e8400-e29b-41d4-a716-446655440000';
    const marker = `[[dice:v1:${nodeId}:1d20]]`;
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'u1',
      threadId: 't1',
      content: `旧位置 ${marker}`,
      version: 1,
      thread: { published: true },
      diceRolls: [{ id: 'r1', nodeId, notation: '1d20' }],
      subthread: { deletedAt: null },
    });
    mockPrisma.post.update.mockResolvedValue({
      id: 'p1',
      content: `${marker} 新位置`,
      parentPostId: null,
      author: { username: 'test' },
    });

    await service.update('p1', { version: 1, content: `${marker} 新位置` }, 'u1');

    expect(mockPrisma.diceRoll.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.diceRoll.createMany).not.toHaveBeenCalled();
  });

  it('update 删除已结算骰子节点时物理删除对应结果', async () => {
    const nodeId = '550e8400-e29b-41d4-a716-446655440000';
    const marker = `[[dice:v1:${nodeId}:1d20]]`;
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'u1',
      threadId: 't1',
      content: `正文 ${marker}`,
      version: 1,
      thread: { published: true },
      diceRolls: [{ id: 'r1', nodeId, notation: '1d20' }],
      subthread: { deletedAt: null },
    });
    mockPrisma.post.update.mockResolvedValue({
      id: 'p1',
      content: '只保留正文',
      parentPostId: null,
      author: { username: 'test' },
    });

    await service.update('p1', { version: 1, content: '只保留正文' }, 'u1');

    expect(mockPrisma.diceRoll.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] }, postId: 'p1' },
    });
    expect(mockPrisma.diceRoll.createMany).not.toHaveBeenCalled();
  });

  it('update 不允许用同一 nodeId 篡改已结算骰子的表达式', async () => {
    const nodeId = '550e8400-e29b-41d4-a716-446655440000';
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'u1',
      threadId: 't1',
      content: `[[dice:v1:${nodeId}:1d20]]`,
      version: 1,
      thread: { published: true },
      diceRolls: [{ id: 'r1', nodeId, notation: '1d20' }],
      subthread: { deletedAt: null },
    });
    mockPrisma.post.update.mockResolvedValue({ id: 'p1' });

    await expect(
      service.update('p1', { version: 1, content: `[[dice:v1:${nodeId}:1d100]]` }, 'u1'),
    ).rejects.toThrow('已结算骰子不能修改表达式');

    expect(mockPrisma.diceRoll.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.diceRoll.createMany).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      'post.updated',
      expect.anything(),
    );
  });

  it('update 应将规范化正文用于存库和提及同步', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'u1',
      threadId: 't1',
      content: '旧内容',
      subthread: { deletedAt: null },
    });
    mockPrisma.post.update.mockResolvedValue({
      id: 'p1',
      content: '编辑后\n<br />',
      parentPostId: null,
      author: { username: 'test' },
    });

    await service.update('p1', { version: 1, content: '编辑后\r\n<br>' }, 'u1');

    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: '编辑后\n<br />' }),
      }),
    );
    expect(mockMentions.syncMentions).toHaveBeenCalledWith(
      'p1',
      '编辑后\n<br />',
      'u1',
      't1',
      '旧内容',
    );
  });

  it('update 编辑他人的帖子应该返回403', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'other',
      subthread: { deletedAt: null },
    });
    await expect(service.update('p1', { version: 1, content: 'x' }, 'u1')).rejects.toThrow(
      BusinessException,
    );
  });

  it('remove 软删除非第一楼应该成功', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'u1',
      kind: 'FLOOR',
      floorNumber: 3,
      parentPostId: 'p0',
      threadId: 't1',
      subthread: { deletedAt: null },
    });
    mockPrisma.post.update.mockResolvedValue({ id: 'p1', deletedAt: new Date() });
    await service.remove('p1', 'u1');
    expect(mockPrisma.post.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('remove 正文帖（kind=BODY）应该返回403', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'u1',
      kind: 'BODY',
      threadId: 't1',
      subthread: { deletedAt: null },
    });
    await expect(service.remove('p1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('管理者可以软删除他人的楼层', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      authorId: 'other',
      kind: 'FLOOR',
      parentPostId: null,
      threadId: 't1',
      subthread: { deletedAt: null },
    });
    mockPrisma.post.update.mockResolvedValue({ id: 'p1', deletedAt: new Date() });

    await service.remove('p1', 'manager');

    expect(mockThreadAccess.assertCanManage).toHaveBeenCalledWith('t1', 'manager');
    expect(mockPrisma.post.update).toHaveBeenCalled();
  });

  it('create PLAYERS 权限非玩家应该返回403', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      postingPolicy: 'PLAYERS',
    });
    mockPrisma.threadMember.upsert.mockResolvedValue({});
    mockPrisma.threadMember.findUnique.mockResolvedValue({
      role: 'PARTICIPANT',
      playerMarked: false,
    });
    await expect(service.create('s1', { content: 'test' }, 'u1')).rejects.toThrow(
      BusinessException,
    );
  });

  it('create PLAYERS 权限允许未标记玩家的协作者发言', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      title: '玩家区',
      postingPolicy: 'PLAYERS',
      thread: { published: true },
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue({
      role: 'COLLABORATOR',
      playerMarked: false,
    });
    mockPrisma.$transaction.mockImplementation(async (fn) =>
      fn({
        $queryRaw: jest.fn(),
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 0 } }),
          create: jest.fn().mockResolvedValue({
            id: 'p1',
            floorNumber: 1,
            author: { username: 'collab' },
          }),
        },
        subthread: { update: jest.fn() },
      }),
    );

    await expect(service.create('s1', { content: '协作者更新' }, 'collab')).resolves.toMatchObject({
      id: 'p1',
    });
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'post.created',
      expect.objectContaining({
        authorRole: 'COLLABORATOR',
        authorPlayerMarked: false,
      }),
    );
  });

  it('findAllBySubthread 应该返回楼层及内嵌前 5 条楼中楼回复', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    mockPrisma.post.findMany
      .mockResolvedValueOnce([{ id: 'p1', author: {}, _count: { replies: 2 } }])
      .mockResolvedValueOnce([
        { id: 'r1', parentPostId: 'p1', author: {}, replyToPost: null },
        { id: 'r2', parentPostId: 'p1', author: {}, replyToPost: null },
      ]);
    const result = await service.findAllBySubthread('s1');
    expect((result.items[0] as any).replies).toHaveLength(2);
    // 楼层查询 where 只包含 kind=FLOOR
    expect(mockPrisma.post.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ kind: 'FLOOR', parentPostId: null }),
      }),
    );
    expect(mockPrisma.post.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: { in: ['r1', 'r2'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('findAllBySubthread 无回复楼层应返回空 replies 数组', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p1', author: {}, _count: { replies: 0 } }]);
    const result = await service.findAllBySubthread('s1');
    expect((result.items[0] as any).replies).toEqual([]);
  });

  it('findReplies 应该返回楼中楼', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p1',
      threadId: 't1',
      kind: 'FLOOR',
      parentPostId: null,
      subthread: { deletedAt: null },
    });
    mockPrisma.post.findMany.mockResolvedValue([{ id: 'p2', author: {}, replyToPost: null }]);
    const result = await service.findReplies('p1');
    expect(result.items[0].id).toBe('p2');
    expect(mockPrisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('findReplies 拒绝以楼中楼回复作为讨论根', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({
      id: 'p2',
      threadId: 't1',
      kind: 'FLOOR',
      parentPostId: 'p1',
      subthread: { deletedAt: null },
    });

    await expect(service.findReplies('p2')).rejects.toThrow(BusinessException);
    expect(mockPrisma.post.findMany).not.toHaveBeenCalled();
  });

  it('findById 应该返回帖子详情', async () => {
    mockPrisma.post.findUnique
      .mockResolvedValueOnce({ id: 'p1', threadId: 't1', subthread: { deletedAt: null } })
      .mockResolvedValueOnce({
        id: 'p1',
        author: {},
        thread: {},
        subthread: {},
        parentPost: null,
        _count: { replies: 0 },
      });
    const result = await service.findById('p1');
    expect(result.id).toBe('p1');
  });
});
