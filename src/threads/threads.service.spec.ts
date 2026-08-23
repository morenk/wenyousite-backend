import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ThreadsService } from './threads.service';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { ThreadAccessService } from '../access/thread-access.service';
import { BlockFilterService } from '../access/block-filter.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { DiceService } from '../dice/dice.service';
import { PaginatedResult } from '../common/dto/paginated-result';
import { ThreadQueryService } from './thread-query.service';
import { OutboxService } from '../outbox/outbox.service';
import { StickerContentService } from '../stickers/sticker-content.service';
import { ThreadCreateIdempotencyService } from './thread-create-idempotency.service';
import { ThreadCategoriesService } from '../taxonomy/thread-categories.service';
import { MediaReferenceService } from '../media/media-reference.service';
import { ThreadReactionService } from './thread-reaction.service';
import { ThreadInviteService } from './thread-invite.service';

const mockCategories = {
  assertSelectable: jest.fn(async (slug: string) => slug.trim().toUpperCase()),
};

const mockPrisma = {
  $transaction: jest.fn(),
  $executeRaw: jest.fn().mockResolvedValue(1),
  thread: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
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
    update: jest.fn(),
  },
  diceRoll: { createMany: jest.fn() },
  userBookmark: {
    findUnique: jest.fn(),
  },
  threadLike: {
    findUnique: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockTags = {
  findOrCreate: jest.fn(),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
};
const mockThreadAccess = {
  assertAccessible: jest.fn(),
  assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER' }),
};
const mockBlockFilter = {
  loadBlockSets: jest
    .fn()
    .mockResolvedValue({ blockedByUser: new Set(), blockedByAuthor: new Set() }),
  filterRecipients: jest.fn((ids: string[]) => ids),
};
const mockNotificationProducer = { notify: jest.fn().mockResolvedValue(undefined) };
const mockOutbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
const mockEventEmitter = { emit: jest.fn() };
const mockRedis = {
  hincrby: jest.fn().mockResolvedValue(1),
  hincrbyAtLeast: jest.fn().mockResolvedValue(1),
  hset: jest.fn().mockResolvedValue(1),
  hdelAll: jest.fn().mockResolvedValue(1),
  zadd: jest.fn().mockResolvedValue(1),
  zrem: jest.fn().mockResolvedValue(1),
  zrevrange: jest.fn().mockResolvedValue([]),
  zcard: jest.fn().mockResolvedValue(100),
};
const mockCache = {
  buildKey: jest.fn((...parts: string[]) => parts.join(':')),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delByPattern: jest.fn().mockResolvedValue(undefined),
};

describe('ThreadsService', () => {
  let service: ThreadsService;
  let diceService: DiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsService,
        ThreadQueryService,
        ThreadCreateIdempotencyService,
        ThreadReactionService,
        ThreadInviteService,
        DiceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TagsService, useValue: mockTags },
        { provide: ThreadAccessService, useValue: mockThreadAccess },
        { provide: BlockFilterService, useValue: mockBlockFilter },
        { provide: NotificationProducer, useValue: mockNotificationProducer },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: RedisService, useValue: mockRedis },
        { provide: CacheService, useValue: mockCache },
        { provide: OutboxService, useValue: mockOutbox },
        { provide: ThreadCategoriesService, useValue: mockCategories },
        {
          provide: MediaReferenceService,
          useValue: {
            syncPostContent: jest.fn().mockResolvedValue(undefined),
            releaseThreadContent: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StickerContentService,
          useValue: { assertContentAllowed: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    service = module.get<ThreadsService>(ThreadsService);
    diceService = module.get<DiceService>(DiceService);
    jest.clearAllMocks();
    mockPrisma.thread.findFirst.mockResolvedValue(null);
    mockPrisma.post.findMany.mockResolvedValue([]);
    mockPrisma.threadMember.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async (fn) =>
      fn({
        $queryRaw: jest.fn(),
        thread: mockPrisma.thread,
        threadMember: mockPrisma.threadMember,
        post: mockPrisma.post,
        diceRoll: mockPrisma.diceRoll,
      }),
    );
  });

  describe('create', () => {
    it('相同 clientRequestId 复用于不同载荷时返回稳定冲突码', async () => {
      mockPrisma.thread.findFirst.mockResolvedValue({ id: 't1', createRequestHash: 'other' });

      await expect(
        service.create(
          {
            title: '新草稿',
            clientRequestId: '99454040-6a52-4bf3-8bad-42683c4d09be',
          },
          'u1',
        ),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.IDEMPOTENCY_KEY_REUSED,
        status: 409,
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('创建草稿帖，不通知粉丝', async () => {
      const threadId = 't1';
      mockPrisma.$transaction.mockImplementation(async (fn) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          thread: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({ id: threadId }),
            update: jest.fn().mockResolvedValue({}),
          },
          threadMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
          threadTopicTag: { createMany: jest.fn() },
          subthread: {
            create: jest.fn().mockResolvedValue({ id: 's1', threadId }),
            update: jest.fn().mockResolvedValue({}),
          },
          post: { create: jest.fn().mockResolvedValue({ id: 'p1' }) },
        }),
      );
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: threadId,
        title: '测试',
        category: 'RPG',
        ownerId: 'u1',
        published: false,
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [],
        topicTags: [],
        _count: { members: 1, posts: 0 },
      });

      const result = await service.create({ title: '测试', category: 'RPG' }, 'u1');
      expect(result).toBeDefined();
      expect(mockNotificationProducer.notify).not.toHaveBeenCalled();
    });

    it('无标题时 title 默认为未命名草稿', async () => {
      const threadId = 't1';
      let capturedThreadData: { data: { title: string } } | undefined;
      mockPrisma.$transaction.mockImplementation(async (fn) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          thread: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockImplementation((args: { data: { title: string } }) => {
              capturedThreadData = args;
              return { id: threadId };
            }),
            update: jest.fn().mockResolvedValue({}),
          },
          threadMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
          threadTopicTag: { createMany: jest.fn() },
          subthread: {
            create: jest.fn().mockResolvedValue({ id: 's1', threadId }),
            update: jest.fn().mockResolvedValue({}),
          },
          post: { create: jest.fn().mockResolvedValue({ id: 'p1' }) },
        }),
      );
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: threadId,
        title: '未命名草稿',
        category: 'DEDUCTION',
        published: false,
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [],
        topicTags: [],
        _count: { members: 1, posts: 0 },
      });

      await service.create({}, 'u1');
      expect(capturedThreadData?.data.title).toBe('未命名草稿');
    });

    it('超过草稿上限（10）时拒绝创建', async () => {
      const threadCreate = jest.fn();
      const lockUser = jest.fn().mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(async (fn) =>
        fn({
          $queryRaw: lockUser,
          thread: {
            count: jest.fn().mockResolvedValue(10),
            create: threadCreate,
            update: jest.fn(),
          },
          threadMember: { create: jest.fn() },
          threadTopicTag: { createMany: jest.fn() },
          subthread: { create: jest.fn(), update: jest.fn() },
          post: { create: jest.fn() },
        }),
      );

      await expect(service.create({ title: '测试', tagNames: ['奇幻'] }, 'u1')).rejects.toThrow(
        BusinessException,
      );
      expect(lockUser).toHaveBeenCalled();
      expect(threadCreate).not.toHaveBeenCalled();
      expect(mockTags.findOrCreate).not.toHaveBeenCalled();
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
    it('只展示已发布且楼主未注销的帖子', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);
      await service.findAll({ sort: 'newest' });
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            published: true,
            owner: { is: { deletedAt: null } },
          }),
        }),
      );
    });

    it('优先排列置顶帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);
      await service.findAll({ sort: 'newest' });
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] }),
      );
    });

    it('按主题帖状态筛选', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);
      await service.findAll({ sort: 'newest', status: 'CLOSED' });
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'CLOSED' }),
        }),
      );
      expect(mockCache.buildKey).toHaveBeenCalledWith(
        'threads',
        'list',
        'sort:newest',
        'cat:all',
        'status:CLOSED',
        'tag:all',
        'tagId:all',
        'filter:all',
        'limit:20',
        'shape:category-info-v1',
        'policy:active-owner-v1',
      );
    });

    it('按标签 ID 精确筛选并隔离列表缓存', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);
      const tagId = 'cms7rnyij000z7qdyg6zbge8e';

      await service.findAll({ sort: 'newest', tag: '相似标签名', tagId });

      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topicTags: { some: { tagId } },
          }),
        }),
      );
      expect(mockCache.buildKey).toHaveBeenCalledWith(
        'threads',
        'list',
        'sort:newest',
        'cat:all',
        'status:all',
        'tag:相似标签名',
        `tagId:${tagId}`,
        'filter:all',
        'limit:20',
        'shape:category-info-v1',
        'policy:active-owner-v1',
      );
    });

    it('首页列表从默认主贴正文提取封面并移除正文查询结果', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([
        {
          id: 't-cover',
          title: '有封面的主题',
          defaultSubthread: {
            id: 's-cover',
            title: '主贴',
            posts: [
              {
                content: [
                  '正文',
                  '![一](https://cdn.example.com/one.jpg)',
                  '![二](https://cdn.example.com/two.jpg)',
                ].join('\n'),
              },
            ],
          },
          _count: { members: 1, posts: 0 },
        },
      ]);
      mockPrisma.threadMember.groupBy.mockResolvedValue([]);

      const page = await service.findAll({ sort: 'newest' });

      expect(page.items[0]).toMatchObject({
        preview: '正文',
        coverImages: ['https://cdn.example.com/one.jpg'],
        defaultSubthread: { id: 's-cover', title: '主贴' },
      });
      expect(page.items[0].defaultSubthread).not.toHaveProperty('posts');
    });

    describe('recommended（智能排序）', () => {
      const mkThread = (id: string) => ({
        id,
        title: id,
        category: 'RPG',
        published: true,
        visibility: 'PUBLIC',
        owner: { id: 'u1', username: 'u', avatar: null },
        defaultSubthread: { id: `s-${id}`, title: id, posts: [] },
        topicTags: [],
        _count: { members: 1, posts: 0 },
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
        mockRedis.zrevrange.mockResolvedValue([
          ...rpgIds,
          'x1',
          'x2',
          'x3',
          'x4',
          'x5',
          'x6',
          'x7',
        ]);
        mockPrisma.thread.findMany.mockResolvedValue([
          mkThread('r1'),
          mkThread('r2'),
          mkThread('r3'),
        ]);

        // 第 1 页：consumed=0，切片前 2 个
        const page1 = await service.findAll({
          sort: 'recommended',
          category: 'RPG',
          limit: 2,
        });
        expect(page1.items.map((t: { id: string }) => t.id)).toEqual(['r1', 'r2']);
        expect(page1.pagination.hasMore).toBe(true);
        expect(page1.pagination.cursor).toBe('2');

        // 第 2 页：consumed=2，切片 [2,4)，只返回 r3，不重复
        const page2 = await service.findAll({
          sort: 'recommended',
          category: 'RPG',
          limit: 2,
          cursor: '2',
        });
        expect(page2.items.map((t: { id: string }) => t.id)).toEqual(['r3']);
        expect(page2.pagination.hasMore).toBe(false);
        expect(page2.pagination.cursor).toBeNull();

        // 两页合并无重复
        const merged = [...page1.items, ...page2.items].map((t: { id: string }) => t.id);
        expect(new Set(merged).size).toBe(merged.length);
      });

      it('推荐排序同样返回默认主贴封面', async () => {
        mockRedis.zrevrange.mockResolvedValue(['r1']);
        mockPrisma.thread.findMany.mockResolvedValue([
          {
            ...mkThread('r1'),
            defaultSubthread: {
              id: 's-r1',
              title: '主贴',
              posts: [{ content: '![封面](https://cdn.example.com/cover.jpg)' }],
            },
          },
        ]);

        const page = await service.findAll({ sort: 'recommended' });

        expect(page.items[0].coverImages).toEqual(['https://cdn.example.com/cover.jpg']);
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

        const page = await service.findAll({
          sort: 'recommended',
          category: 'RPG',
          limit: 2,
        });
        expect(mockRedis.zrevrange).toHaveBeenCalledTimes(2);
        expect(page.items.map((t: { id: string }) => t.id)).toEqual(['r1', 'r2']);
        expect(page.pagination.cursor).toBe('2');
      });

      it('ZSET 为空时返回空页', async () => {
        mockRedis.zcard.mockResolvedValue(0);
        mockRedis.zrevrange.mockResolvedValue([]);
        const page = await service.findAll({ sort: 'recommended' });
        expect(page.items).toEqual([]);
        expect(page.pagination.hasMore).toBe(false);
      });

      it('拒绝推荐排序中的非整数不透明游标', async () => {
        await expect(
          service.findAll({ sort: 'recommended', cursor: '2oops' }),
        ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_CURSOR, status: 400 });
        expect(mockRedis.zrevrange).not.toHaveBeenCalled();
      });

      it('智能排序同样按主题帖状态筛选', async () => {
        mockRedis.zrevrange.mockResolvedValue(['t1']);
        mockPrisma.thread.findMany.mockResolvedValue([]);

        await service.findAll({ sort: 'recommended', status: 'FINISHED' });

        expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ status: 'FINISHED' }),
          }),
        );
      });

      it('智能排序同样排除已注销楼主的帖子', async () => {
        mockRedis.zrevrange.mockResolvedValue(['t1']);
        mockPrisma.thread.findMany.mockResolvedValue([]);

        await service.findAll({ sort: 'recommended' });

        expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              owner: { is: { deletedAt: null } },
            }),
          }),
        );
      });

      it('智能排序同样按标签 ID 精确筛选', async () => {
        const tagId = 'cms7rnyij000z7qdyg6zbge8e';
        mockRedis.zrevrange.mockResolvedValue(['t1']);
        mockPrisma.thread.findMany.mockResolvedValue([]);

        await service.findAll({ sort: 'recommended', tagId });

        expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              topicTags: { some: { tagId } },
            }),
          }),
        );
      });

      it('未登录 playing 筛选返回空', async () => {
        const page = await service.findAll({ sort: 'recommended', filter: 'playing' });
        expect(page.items).toEqual([]);
        expect(mockPrisma.thread.findMany).not.toHaveBeenCalled();
        expect(mockCache.get).not.toHaveBeenCalled();
        expect(mockCache.set).not.toHaveBeenCalled();
      });

      it('recommended 公开首页命中短缓存时不访问 ZSET 和数据库', async () => {
        const cached = {
          items: [mkThread('cached')],
          pagination: { cursor: null, hasMore: false },
        };
        mockCache.get.mockResolvedValueOnce(cached);

        const page = await service.findAll({ sort: 'recommended' });

        expect(page).toBeInstanceOf(PaginatedResult);
        expect(page.items).toEqual(cached.items);
        expect(page.pagination).toEqual(cached.pagination);
        expect(mockRedis.zcard).not.toHaveBeenCalled();
        expect(mockPrisma.thread.findMany).not.toHaveBeenCalled();
      });

      it('playing 筛选排除自己创建的帖', async () => {
        mockPrisma.thread.findMany.mockResolvedValue([]);
        mockPrisma.threadMember.groupBy.mockResolvedValue([]);
        await service.findAll({ sort: 'newest', filter: 'playing' }, 'u1');
        const args = mockPrisma.thread.findMany.mock.calls[0][0];
        expect(args.where.members).toEqual({ some: { userId: 'u1', playerMarked: true } });
        expect(args.where.ownerId).toEqual({ not: 'u1' });
      });
    });
  });

  describe('findById', () => {
    it('已发布公开帖只在 Redis 递增 viewCount，不同步写数据库或刷新更新时间', async () => {
      const thread = {
        id: 't1',
        title: '测试',
        published: true,
        visibility: 'PUBLIC',
        owner: { id: 'u1' },
        subthreads: [],
      };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      const result = await service.findById('t1');
      expect(result.id).toBe('t1');
      expect(mockRedis.hincrbyAtLeast).toHaveBeenCalledWith('thread:t1:stats', 'views', 0, 1);
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrisma.thread.update).not.toHaveBeenCalled();
    });

    it('已发布公开详情命中缓存时仍校验权限，但不重复执行昂贵详情查询', async () => {
      const cached = {
        id: 't1',
        title: '缓存主题',
        published: true,
        visibility: 'PUBLIC',
        deletedAt: null,
        categoryInfo: { slug: 'RPG', name: '角色扮演', isActive: true },
        viewCount: 9,
        owner: { id: 'u1' },
        subthreads: [],
      };
      mockCache.get.mockResolvedValueOnce(cached);
      mockRedis.hincrbyAtLeast.mockResolvedValueOnce(10);

      const result = await service.findById('t1');

      expect(result).toMatchObject({ id: 't1', viewCount: 10 });
      expect(mockThreadAccess.assertAccessible).toHaveBeenCalledWith('t1', undefined);
      expect(mockPrisma.thread.findUnique).not.toHaveBeenCalled();
    });

    it('详情合并玩家计数 _count.players（playerMarked=true）', async () => {
      const thread = {
        id: 't1',
        title: '测试',
        published: true,
        visibility: 'PUBLIC',
        owner: { id: 'u1' },
        subthreads: [],
        _count: { members: 5, posts: 3 },
      };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.thread.update.mockResolvedValue({});
      mockPrisma.threadMember.groupBy.mockResolvedValue([{ threadId: 't1', _count: 2 }]);

      const result = await service.findById('t1');
      expect(result._count).toMatchObject({ players: 2, members: 5 }); // 候选池总数保留
      expect(mockPrisma.threadMember.groupBy).toHaveBeenCalledWith({
        by: ['threadId'],
        where: { threadId: { in: ['t1'] }, playerMarked: true },
        _count: true,
      });
    });

    it('无玩家标记成员时 _count.players 为 0', async () => {
      const thread = {
        id: 't1',
        title: '测试',
        published: true,
        visibility: 'PUBLIC',
        owner: { id: 'u1' },
        subthreads: [],
        _count: { members: 5, posts: 3 },
      };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.thread.update.mockResolvedValue({});
      mockPrisma.threadMember.groupBy.mockResolvedValue([]);

      const result = await service.findById('t1');
      expect(result._count).toMatchObject({ players: 0 });
    });

    it('不存在返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toThrow(BusinessException);
    });

    it('未发布帖：owner 可查看', async () => {
      const thread = {
        id: 't1',
        title: '草稿',
        published: false,
        ownerId: 'u1',
        visibility: 'PUBLIC',
        owner: { id: 'u1' },
        subthreads: [],
      };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      const result = await service.findById('t1', 'u1');
      expect(result.id).toBe('t1');
    });

    it('登录态附加 isBookmarked、bookmarkId 与 isLiked', async () => {
      const thread = {
        id: 't1',
        title: '测试',
        published: true,
        visibility: 'PUBLIC',
        owner: { id: 'u1' },
        subthreads: [],
      };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.thread.update.mockResolvedValue({});
      mockPrisma.userBookmark.findUnique.mockResolvedValue({ id: 'bm1' });
      mockPrisma.threadLike.findUnique.mockResolvedValue({ id: 'like1' });

      const result = await service.findById('t1', 'u1');
      expect(result).toMatchObject({ isBookmarked: true, bookmarkId: 'bm1', isLiked: true });
      expect(mockPrisma.userBookmark.findUnique).toHaveBeenCalledWith({
        where: { userId_threadId: { userId: 'u1', threadId: 't1' } },
        select: { id: true, folderId: true },
      });
      expect(mockPrisma.threadLike.findUnique).toHaveBeenCalledWith({
        where: { threadId_userId: { userId: 'u1', threadId: 't1' } },
        select: { id: true },
      });
    });

    it('未登录不附加收藏字段', async () => {
      const thread = {
        id: 't1',
        title: '测试',
        published: true,
        visibility: 'PUBLIC',
        owner: { id: 'u1' },
        subthreads: [],
      };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.thread.update.mockResolvedValue({});

      const result = await service.findById('t1');
      expect(result).not.toHaveProperty('isBookmarked');
      expect(result).not.toHaveProperty('isLiked');
      expect(mockPrisma.userBookmark.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.threadLike.findUnique).not.toHaveBeenCalled();
    });

    it('未发布帖：非 owner 返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        published: false,
        ownerId: 'u1',
        visibility: 'PUBLIC',
      });
      mockThreadAccess.assertAccessible.mockRejectedValueOnce(
        new BusinessException(ErrorCode.FORBIDDEN, ''),
      );
      await expect(service.findById('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('未发布帖：未登录返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        published: false,
        ownerId: 'u1',
        visibility: 'PUBLIC',
      });
      mockThreadAccess.assertAccessible.mockRejectedValueOnce(
        new BusinessException(ErrorCode.FORBIDDEN, ''),
      );
      await expect(service.findById('t1')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖非成员应返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        published: true,
        visibility: 'PRIVATE',
      });
      mockPrisma.threadMember.findUnique.mockResolvedValue(null);
      mockPrisma.thread.update.mockResolvedValue({});
      mockThreadAccess.assertAccessible.mockRejectedValueOnce(
        new BusinessException(ErrorCode.FORBIDDEN, ''),
      );
      await expect(service.findById('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖成员应正常返回', async () => {
      const thread = {
        id: 't1',
        title: '私密帖',
        published: true,
        visibility: 'PRIVATE',
        owner: { id: 'u1' },
        subthreads: [],
      };
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
        id: 't1',
        title: '新标题',
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [],
        topicTags: [],
        _count: { members: 1, posts: 0 },
      });
      const result = await service.update('t1', { version: 1, title: '新标题' }, 'u1');
      expect(result.title).toBe('新标题');
    });

    it('无权限返回403', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      mockThreadAccess.assertCanManage.mockRejectedValueOnce(
        new BusinessException(ErrorCode.FORBIDDEN, ''),
      );
      await expect(service.update('t1', { version: 1, title: 'x' }, 'u2')).rejects.toThrow(
        BusinessException,
      );
    });

    it('协作者可以修改内容元数据', async () => {
      mockThreadAccess.assertCanManage.mockResolvedValueOnce({ role: 'COLLABORATOR' });
      mockPrisma.thread.update.mockResolvedValue({
        id: 't1',
        title: '协作标题',
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [],
        topicTags: [],
        _count: { members: 2, posts: 0 },
      });
      await expect(
        service.update('t1', { version: 1, title: '协作标题' }, 'u2'),
      ).resolves.toMatchObject({ title: '协作标题' });
    });

    it.each([[{ visibility: 'PRIVATE' as const }], [{ published: true }]])(
      '协作者不能修改楼主专属字段 %#',
      async (fields) => {
        mockThreadAccess.assertCanManage.mockResolvedValueOnce({ role: 'COLLABORATOR' });
        await expect(service.update('t1', { version: 1, ...fields }, 'u2')).rejects.toMatchObject({
          status: 403,
        });
        expect(mockPrisma.thread.update).not.toHaveBeenCalled();
      },
    );

    it('已发布主题帖不能撤回为草稿', async () => {
      await expect(service.update('t1', { version: 1, published: false }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });

    it('发布时应校验并在事务中记录领域事件', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({
        published: false,
        title: '测试',
        category: 'RPG',
        defaultSubthread: { id: 's1', posts: [{ content: '正文' }] },
      });
      mockPrisma.thread.update.mockResolvedValue({
        id: 't1',
        title: '测试',
        category: 'RPG',
        published: true,
        ownerId: 'u1',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date(),
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [],
        topicTags: [],
        _count: { members: 1, posts: 1 },
      });
      mockPrisma.userFollow.findMany.mockResolvedValue([{ followerId: 'f1' }]);

      const result = await service.update('t1', { version: 1, published: true }, 'u1');
      expect(result.published).toBe(true);
      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'thread.published',
          eventKey: 'thread-published:t1',
        }),
      );
    });

    it('发布时在同一事务结算全部待掷骰子并清空意图', async () => {
      const tx = {
        $queryRaw: jest.fn(),
        thread: {
          findUnique: jest.fn().mockResolvedValue({
            published: false,
            title: '测试',
            category: 'RPG',
            defaultSubthread: { id: 's1', posts: [{ content: '正文' }] },
          }),
          update: jest.fn().mockResolvedValue({
            id: 't1',
            title: '测试',
            category: 'RPG',
            published: true,
            ownerId: 'u1',
            createdAt: new Date('2025-01-01'),
            updatedAt: new Date(),
            owner: { id: 'u1', username: 'test', avatar: null },
            subthreads: [],
            topicTags: [],
            _count: { members: 1, posts: 2 },
          }),
        },
        threadMember: { findMany: jest.fn().mockResolvedValue([]) },
        post: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'p1',
              kind: 'FLOOR',
              content: '[[dice:v1:550e8400-e29b-41d4-a716-446655440000:1d20]]',
              authorId: 'u1',
              author: { username: 'test' },
              subthreadId: 's1',
              subthread: { title: '测试' },
              parentPostId: null,
              replyToPostId: null,
            },
            {
              id: 'p2',
              kind: 'FLOOR',
              content: '[[dice:v1:550e8400-e29b-41d4-a716-446655440001:2d6+3]]',
              authorId: 'u1',
              author: { username: 'test' },
              subthreadId: 's1',
              subthread: { title: '测试' },
              parentPostId: null,
              replyToPostId: null,
            },
          ]),
          update: jest.fn().mockResolvedValue({}),
        },
        diceRoll: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(tx));
      mockPrisma.post.findMany.mockResolvedValue([]);
      mockPrisma.userFollow.findMany.mockResolvedValue([]);
      jest
        .spyOn(diceService, 'rollNodes')
        .mockReturnValueOnce([
          {
            nodeId: '550e8400-e29b-41d4-a716-446655440000',
            notation: '1d20',
            quantity: 1,
            sides: 20,
            modifier: 0,
            protocolVersion: 1,
            results: [14],
            total: 14,
          },
        ])
        .mockReturnValueOnce([
          {
            nodeId: '550e8400-e29b-41d4-a716-446655440001',
            notation: '2d6+3',
            quantity: 2,
            sides: 6,
            modifier: 3,
            protocolVersion: 1,
            results: [2, 5],
            total: 10,
          },
        ]);

      await service.update('t1', { version: 1, published: true }, 'u1');

      expect(tx.diceRoll.createMany).toHaveBeenNthCalledWith(1, {
        data: [
          expect.objectContaining({
            postId: 'p1',
            nodeId: '550e8400-e29b-41d4-a716-446655440000',
            total: 14,
          }),
        ],
      });
      expect(tx.diceRoll.createMany).toHaveBeenNthCalledWith(2, {
        data: [
          expect.objectContaining({
            postId: 'p2',
            nodeId: '550e8400-e29b-41d4-a716-446655440001',
            total: 10,
          }),
        ],
      });
      expect(tx.post.update).toHaveBeenCalledTimes(2);
      expect(tx.post.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { version: { increment: 1 } },
        }),
      );
      expect(tx.thread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ published: true, version: { increment: 1 } }),
        }),
      );
    });

    it('任一骰子写入失败时不得提交发布状态', async () => {
      const threadUpdate = jest.fn();
      const tx = {
        $queryRaw: jest.fn(),
        thread: {
          findUnique: jest.fn().mockResolvedValue({
            published: false,
            title: '测试',
            category: 'RPG',
            defaultSubthread: { id: 's1', posts: [{ content: '正文' }] },
          }),
          update: threadUpdate,
        },
        threadMember: { findMany: jest.fn().mockResolvedValue([]) },
        post: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'p1',
              content: '[[dice:v1:550e8400-e29b-41d4-a716-446655440000:1d20]]',
            },
          ]),
          update: jest.fn(),
        },
        diceRoll: { createMany: jest.fn().mockRejectedValue(new Error('db write failed')) },
      };
      mockPrisma.$transaction.mockImplementation(async (fn) => fn(tx));
      jest.spyOn(diceService, 'rollNodes').mockReturnValue([
        {
          nodeId: '550e8400-e29b-41d4-a716-446655440000',
          notation: '1d20',
          quantity: 1,
          sides: 20,
          modifier: 0,
          protocolVersion: 1,
          results: [14],
          total: 14,
        },
      ]);

      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(
        'db write failed',
      );
      expect(threadUpdate).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('thread.published', expect.anything());
    });

    it('发布时无标题应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({
        published: false,
        title: '',
        category: 'DEDUCTION',
        defaultSubthread: null,
      });
      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });

    it('发布时无子贴应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({
        published: false,
        title: '测试',
        category: 'RPG',
        defaultSubthread: null,
      });
      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });

    it('发布时默认子贴无正文（kind=BODY posts 为空）应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({
        published: false,
        title: '测试',
        category: 'RPG',
        defaultSubthread: { id: 's1', posts: [] },
      });
      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });

    it('已发布的帖不能再发布', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({
        published: true,
        title: '测试',
        category: 'RPG',
        defaultSubthread: null,
      });
      await expect(service.update('t1', { version: 1, published: true }, 'u1')).rejects.toThrow(
        BusinessException,
      );
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

    it('数据库删除失败时不得提前清理缓存或发送删除事件', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        ownerId: 'u1',
        published: true,
      });
      mockPrisma.thread.update.mockRejectedValue(new Error('database unavailable'));

      await expect(service.remove('t1', 'u1')).rejects.toThrow('database unavailable');

      expect(mockRedis.zrem).not.toHaveBeenCalled();
      expect(mockRedis.hdelAll).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith('thread.deleted', expect.anything());
    });
  });

  describe('like counters', () => {
    it('点赞事务只更新数据库并发事件，Redis 由投影监听器单点维护', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        published: true,
        ownerId: 'owner',
        title: '主题',
        likeCount: 0,
      });
      mockPrisma.$transaction.mockImplementation(async (fn) =>
        fn({
          threadLike: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
          thread: { update: jest.fn().mockResolvedValue({ id: 't1', likeCount: 1 }) },
        }),
      );

      await expect(service.like('t1', 'u1', '用户')).resolves.toEqual({
        id: 't1',
        likeCount: 1,
      });

      expect(mockRedis.hincrby).not.toHaveBeenCalled();
      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'thread.liked',
          eventKey: expect.stringMatching(/^thread-liked:t1:u1:/),
        }),
      );
    });

    it('取消点赞与计数递减原子提交，Redis 不在命令服务重复写入', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', published: true, likeCount: 1 });
      mockPrisma.$transaction.mockImplementation(async (fn) =>
        fn({
          threadLike: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
          thread: { update: jest.fn().mockResolvedValue({ id: 't1', likeCount: 0 }) },
        }),
      );

      await expect(service.unlike('t1', 'u1')).resolves.toEqual({
        id: 't1',
        likeCount: 0,
      });

      expect(mockRedis.hincrby).not.toHaveBeenCalled();
      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'thread.unliked',
          eventKey: expect.stringMatching(/^thread-unliked:t1:u1:/),
        }),
      );
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
      mockThreadAccess.assertCanManage.mockRejectedValueOnce(
        new BusinessException(ErrorCode.FORBIDDEN, ''),
      );
      await expect(service.assertCanManage('t1', 'u1')).rejects.toThrow(BusinessException);
    });
  });

  describe('createInviteLink', () => {
    it('未发布帖禁止生成邀请链接', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        ownerId: 'u1',
        published: false,
        visibility: 'PRIVATE',
      });
      await expect(service.createInviteLink('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('公开帖禁止生成邀请链接', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        ownerId: 'u1',
        published: true,
        visibility: 'PUBLIC',
      });
      await expect(service.createInviteLink('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('私密已发布帖正常生成', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        ownerId: 'u1',
        published: true,
        visibility: 'PRIVATE',
      });
      mockPrisma.threadInvite.upsert.mockResolvedValue({
        id: 'inv1',
        threadId: 't1',
        token: 'abc123',
      });
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
        thread: {
          id: 't1',
          title: 'test',
          category: 'RPG',
          status: 'RECRUITING',
          visibility: 'PRIVATE',
          published: false,
          deletedAt: null,
          createdAt: new Date(),
          owner: { id: 'u1', username: 'a', avatar: null },
        },
      });
      await expect(service.previewInviteLink('token123')).rejects.toThrow(BusinessException);
    });

    it('公开帖禁止通过邀请预览', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: {
          id: 't1',
          title: 'test',
          category: 'RPG',
          status: 'RECRUITING',
          visibility: 'PUBLIC',
          published: true,
          deletedAt: null,
          createdAt: new Date(),
          owner: { id: 'u1', username: 'a', avatar: null },
        },
      });
      await expect(service.previewInviteLink('token123')).rejects.toThrow(BusinessException);
    });

    it('软删除帖禁止预览', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: {
          id: 't1',
          title: 'test',
          category: 'RPG',
          status: 'RECRUITING',
          visibility: 'PRIVATE',
          published: true,
          deletedAt: new Date(),
          createdAt: new Date(),
          owner: { id: 'u1', username: 'a', avatar: null },
        },
      });
      await expect(service.previewInviteLink('token123')).rejects.toThrow(BusinessException);
    });

    it('正常预览私密帖', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: {
          id: 't1',
          title: '奇幻大陆',
          category: 'RPG',
          status: 'RECRUITING',
          visibility: 'PRIVATE',
          published: true,
          deletedAt: null,
          createdAt: new Date(),
          owner: { id: 'u1', username: '张三', avatar: null },
        },
      });
      mockPrisma.threadMember.count.mockResolvedValue(5);
      mockPrisma.threadMember.findUnique.mockResolvedValue(null);
      const result = await service.previewInviteLink('token123', 'u2');
      expect(result.thread.id).toBe('t1');
      expect(result.thread.title).toBe('奇幻大陆');
      expect(result.thread.category).toBe('RPG');
      expect(result.thread.status).toBe('RECRUITING');
      expect(result.thread.owner.username).toBe('张三');
      expect(result.thread.memberCount).toBe(5);
      expect(result.alreadyJoined).toBe(false);
    });

    it('已加入用户预览邀请时返回可直接进入的状态', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: {
          id: 't1',
          title: '奇幻大陆',
          category: 'RPG',
          status: 'RECRUITING',
          visibility: 'PRIVATE',
          published: true,
          deletedAt: null,
          createdAt: new Date(),
          owner: { id: 'u1', username: '张三', avatar: null },
        },
      });
      mockPrisma.threadMember.count.mockResolvedValue(5);
      mockPrisma.threadMember.findUnique.mockResolvedValue({ id: 'm2' });

      const result = await service.previewInviteLink('token123', 'u2');

      expect(result.alreadyJoined).toBe(true);
    });
  });

  describe('joinByInviteLink', () => {
    it('未发布帖禁止通过邀请加入', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', visibility: 'PRIVATE', published: false },
      });
      await expect(service.joinByInviteLink('token123', 'u2')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖正常加入', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', visibility: 'PRIVATE', published: true },
      });
      mockPrisma.threadMember.upsert.mockResolvedValue({ id: 'm1', thread: {}, user: {} });
      const result = await service.joinByInviteLink('token123', 'u2');
      expect(result.id).toBe('m1');
    });

    it('重复加入时幂等返回已有成员记录', async () => {
      const existing = {
        id: 'm-existing',
        thread: { id: 't1', title: '私密帖' },
        user: { id: 'u2' },
      };
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', visibility: 'PRIVATE', published: true },
      });
      mockPrisma.threadMember.upsert.mockResolvedValue(existing);

      await expect(service.joinByInviteLink('token123', 'u2')).resolves.toBe(existing);
      expect(mockPrisma.threadMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { threadId_userId: { threadId: 't1', userId: 'u2' } },
          update: {},
        }),
      );
    });
  });

  describe('findByCreatedUser', () => {
    const mkThread = (id: string, visibility = 'PUBLIC') => ({
      id,
      title: id,
      category: 'RPG',
      status: 'RECRUITING',
      published: true,
      visibility,
      pinned: false,
      tipTotal: 0n,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
      deletedAt: null,
      owner: { id: 'u1', username: 'u', avatar: null },
      defaultSubthread: {
        id: `s-${id}`,
        title: id,
        lastPostAt: null,
        posts: [{ content: `正文 ${id}\n![封面](https://cdn.example.com/${id}.jpg)` }],
      },
      topicTags: [],
      _count: { members: 1, posts: 0 },
    });

    beforeEach(() => {
      mockPrisma.thread.findMany.mockReset();
      mockPrisma.threadMember.groupBy.mockResolvedValue([]);
    });

    it('本人查看返回全部已发布帖（含私密帖）', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([
        mkThread('t1', 'PUBLIC'),
        mkThread('t2', 'PRIVATE'),
      ]);
      const page = await service.findByCreatedUser('u1', 'u1');
      const args = mockPrisma.thread.findMany.mock.calls[0][0];
      expect(args.where.ownerId).toBe('u1');
      expect(args.where.published).toBe(true);
      expect(args.where.visibility).toBeUndefined();
      expect(page.items.map((t) => t.id)).toEqual(['t1', 't2']);
      expect(page.items[0]).toEqual(
        expect.objectContaining({
          preview: '正文 t1',
          coverImages: ['https://cdn.example.com/t1.jpg'],
          defaultSubthread: { id: 's-t1', title: 't1', lastPostAt: null },
          _count: { members: 1, posts: 0, players: 0 },
        }),
      );
      expect(args.include).toEqual(
        expect.objectContaining({ defaultSubthread: expect.anything() }),
      );
    });

    it('他人查看仅返回 PUBLIC 已发布帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([mkThread('t1', 'PUBLIC')]);
      const page = await service.findByCreatedUser('u1', 'viewer');
      const args = mockPrisma.thread.findMany.mock.calls[0][0];
      expect(args.where.visibility).toBe('PUBLIC');
      expect(page.items.map((t) => t.id)).toEqual(['t1']);
    });

    it('cursor 分页返回 hasMore 与下一页游标', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([
        mkThread('t1'),
        mkThread('t2'),
        mkThread('t3'),
      ]);
      const page = await service.findByCreatedUser('u1', 'u1', undefined, 2);
      expect(page.items.map((t) => t.id)).toEqual(['t1', 't2']);
      expect(page.pagination.hasMore).toBe(true);
      expect(page.pagination.cursor).toBe('t2');
    });
  });

  describe('findByPlayedUser', () => {
    beforeEach(() => {
      mockPrisma.threadMember.findMany.mockReset();
      mockPrisma.threadMember.groupBy.mockResolvedValue([]);
    });

    it('本人列表也只包含已被授予玩家身份的非自建帖', async () => {
      mockPrisma.threadMember.findMany.mockResolvedValue([
        {
          id: 'm1',
          thread: {
            id: 't1',
            title: '参与主题',
            category: 'RPG',
            status: 'RECRUITING',
            published: true,
            visibility: 'PRIVATE',
            pinned: false,
            tipTotal: 0n,
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
            updatedAt: new Date('2026-08-02T00:00:00.000Z'),
            deletedAt: null,
            owner: { id: 'owner', username: '楼主', avatar: null },
            defaultSubthread: {
              id: 's1',
              title: '主贴',
              lastPostAt: null,
              posts: [{ content: '参与正文' }],
            },
            topicTags: [],
            _count: { members: 2, posts: 4 },
          },
        },
      ]);
      mockPrisma.threadMember.groupBy.mockResolvedValue([{ threadId: 't1', _count: 2 }]);
      const page = await service.findByPlayedUser('u1', 'u1');
      const args = mockPrisma.threadMember.findMany.mock.calls[0][0];
      expect(args.where.playerMarked).toBe(true);
      expect(args.where.thread.visibility).toBeUndefined();
      expect(args.where.thread.ownerId).toEqual({ not: 'u1' });
      expect(args.include.thread.include).toEqual(
        expect.objectContaining({ defaultSubthread: expect.anything() }),
      );
      expect(page.items[0]).toEqual(
        expect.objectContaining({
          preview: '参与正文',
          coverImages: [],
          _count: { members: 2, posts: 4, players: 2 },
        }),
      );
    });

    it('本人可按私密帖分类筛选且筛选发生在分页查询前', async () => {
      mockPrisma.threadMember.findMany.mockResolvedValue([]);

      await service.findByPlayedUser('u1', 'u1', undefined, 20, 'PRIVATE');

      const args = mockPrisma.threadMember.findMany.mock.calls[0][0];
      expect(args.where.thread.visibility).toBe('PRIVATE');
    });

    it('他人列表仍只显示公开且已标记为玩家的帖子', async () => {
      mockPrisma.threadMember.findMany.mockResolvedValue([]);

      await service.findByPlayedUser('u1', 'viewer');

      const args = mockPrisma.threadMember.findMany.mock.calls[0][0];
      expect(args.where.playerMarked).toBe(true);
      expect(args.where.thread.visibility).toBe('PUBLIC');
    });

    it('他人请求私密分类时返回空列表且不查询成员数据', async () => {
      const page = await service.findByPlayedUser('u1', 'viewer', undefined, 20, 'PRIVATE');

      expect(page.items).toEqual([]);
      expect(mockPrisma.threadMember.findMany).not.toHaveBeenCalled();
    });
  });
});
