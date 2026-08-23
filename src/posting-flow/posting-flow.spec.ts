/** 发帖全流程集成测试：主题帖 → 子贴 → 楼层 → 楼中楼 → 编辑/删除 */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PostsService } from '../posts/posts.service';
import { SubthreadsService } from '../subthreads/subthreads.service';
import { ThreadsService } from '../threads/threads.service';
import { ThreadMembersService } from '../threads/thread-members.service';
import { DiceService } from '../dice/dice.service';
import { MentionsService } from '../mentions/mentions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { BlockFilterService } from '../access/block-filter.service';
import { TagsService } from '../tags/tags.service';
import { NotificationProducer } from '../notifications/notification.producer';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { PostingPolicyService } from '../access/posting-policy.service';
import { PostQueryService } from '../posts/post-query.service';
import { ThreadQueryService } from '../threads/thread-query.service';
import { ThreadCreateIdempotencyService } from '../threads/thread-create-idempotency.service';
import { OutboxService } from '../outbox/outbox.service';
import { StickerContentService } from '../stickers/sticker-content.service';
import { ThreadCategoriesService } from '../taxonomy/thread-categories.service';
import { MediaReferenceService } from '../media/media-reference.service';
import { PostMentionEventsService } from '../posts/post-mention-events.service';
import { ThreadReactionService } from '../threads/thread-reaction.service';
import { ThreadInviteService } from '../threads/thread-invite.service';

// ============ Mock 基础设施 ============
const createMockPrisma = () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn().mockResolvedValue(1),
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  thread: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn().mockResolvedValue([]),
  },
  threadInvite: { upsert: jest.fn(), findUnique: jest.fn() },
  threadTopicTag: { createMany: jest.fn() },
  subthread: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  post: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  diceRoll: { createMany: jest.fn() },
  postMention: { createMany: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  userFollow: { findMany: jest.fn() },
  userBlock: { findMany: jest.fn(), findFirst: jest.fn() },
  notification: {
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
  subscription: { findMany: jest.fn() },
  userBookmark: { findUnique: jest.fn() },
  threadLike: { findUnique: jest.fn() },
});

const mockCategories = {
  assertSelectable: jest.fn(async (slug: string) => slug.trim().toUpperCase()),
};

// 最小化的事务模拟函数
const basicTx = () => ({
  $queryRaw: jest.fn(),
  threadMember: { upsert: jest.fn().mockResolvedValue({}) },
  thread: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  post: { aggregate: jest.fn(), create: jest.fn() },
  subthread: {
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn(),
    findUnique: jest.fn(),
    aggregate: jest.fn(),
    findFirst: jest.fn(),
  },
});

const invokeTransaction = <T>(callback: unknown, transaction: unknown): T => {
  if (typeof callback !== 'function') {
    throw new TypeError('Expected a transaction callback');
  }
  return (callback as (tx: unknown) => T)(transaction);
};

/** 为主题帖创建流程准备 $transaction 模拟 */
const setupThreadTransaction = (prisma: MockPrisma, threadId = 't1', subthreadId = 's1') => {
  const tx = {
    $queryRaw: jest.fn(),
    thread: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: threadId }),
      update: jest.fn().mockResolvedValue({}),
    },
    threadMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    subthread: {
      create: jest.fn().mockResolvedValue({ id: subthreadId }),
      update: jest.fn().mockResolvedValue({}),
    },
    post: { create: jest.fn().mockResolvedValue({ id: 'p1', floorNumber: 1 }) },
    threadTopicTag: prisma.threadTopicTag,
  };
  prisma.$transaction.mockImplementation(async (fn: unknown) => invokeTransaction(fn, tx));
  return tx;
};

const mockEventEmitter = { emit: jest.fn() };
const mockBlockFilter = {
  loadBlockSets: jest
    .fn()
    .mockResolvedValue({ blockedByUser: new Set(), blockedByAuthor: new Set() }),
  filterRecipients: jest.fn((ids: string[]) => ids),
};
const mockTags = {
  findOrCreate: jest.fn(),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
};
const mockNotificationProducer = { notify: jest.fn().mockResolvedValue(undefined) };
const mockRedis = {
  hincrby: jest.fn().mockResolvedValue(1),
  hincrbyAtLeast: jest.fn().mockResolvedValue(1),
  hgetall: jest.fn().mockResolvedValue({}),
  hset: jest.fn().mockResolvedValue(1),
  hdelAll: jest.fn().mockResolvedValue(1),
  zadd: jest.fn().mockResolvedValue(1),
  zrem: jest.fn().mockResolvedValue(1),
  zrevrange: jest.fn().mockResolvedValue([]),
};
const mockCache = {
  buildKey: jest.fn((...parts: string[]) => parts.join(':')),
  get: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delByPattern: jest.fn().mockResolvedValue(undefined),
};
const mockOutbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

// ============ 辅助工厂 ============
type MockPrisma = ReturnType<typeof createMockPrisma>;

const setupHelpers = {
  mockThreadAccess_pass: (m: MockPrisma) => {
    m.thread.findUnique.mockResolvedValue({ visibility: 'PUBLIC', published: true, ownerId: 'u1' });
  },
  mockThreadAccess_privateMember: (m: MockPrisma) => {
    m.thread.findUnique.mockResolvedValue({
      visibility: 'PRIVATE',
      published: true,
      ownerId: 'u1',
    });
    m.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
  },
  mockSubthread_find: (m: MockPrisma, overrides: Record<string, unknown> = {}) => {
    m.subthread.findUnique.mockResolvedValue({
      id: 's1',
      threadId: 't1',
      title: '子贴A',
      postingPolicy: 'PARTICIPANTS',
      thread: { published: true, title: '主题A' },
      ...overrides,
    });
  },
  mockPost_create_withFloor: (m: MockPrisma, maxFloor: number) => {
    m.$transaction.mockImplementation(async (fn: unknown) => {
      const tx = {
        ...basicTx(),
        threadMember: { upsert: m.threadMember.upsert },
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: maxFloor } }),
          create: jest.fn().mockResolvedValue({
            id: `p${maxFloor + 1}`,
            floorNumber: maxFloor + 1,
            content: 'test',
            author: { id: 'u1', username: 'test', avatar: null },
          }),
        },
      };
      return invokeTransaction(fn, tx);
    });
  },
  mockThreadMember_ownerOrCollab: (m: MockPrisma) => {
    m.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
  },
  mockThreadMember_participant: (m: MockPrisma) => {
    m.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
  },
};

// ============ 测试套件开始 ============
describe('发帖全流程集成测试', () => {
  let postsService: PostsService;
  let subthreadsService: SubthreadsService;
  let threadsService: ThreadsService;
  let membersService: ThreadMembersService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = createMockPrisma();
    jest.clearAllMocks();
    prisma.post.findMany.mockResolvedValue([]);
    prisma.threadMember.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (fn: unknown) => invokeTransaction(fn, prisma));

    const threadAccess = new ThreadAccessService(prisma as unknown as PrismaService);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        SubthreadsService,
        ThreadsService,
        ThreadMembersService,
        DiceService,
        MentionsService,
        PostingPolicyService,
        PostQueryService,
        ThreadQueryService,
        ThreadCreateIdempotencyService,
        PostMentionEventsService,
        ThreadReactionService,
        ThreadInviteService,
        { provide: PrismaService, useValue: prisma },
        { provide: ThreadAccessService, useValue: threadAccess },
        { provide: BlockFilterService, useValue: mockBlockFilter },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: TagsService, useValue: mockTags },
        { provide: NotificationProducer, useValue: mockNotificationProducer },
        { provide: RedisService, useValue: mockRedis },
        { provide: CacheService, useValue: mockCache },
        { provide: OutboxService, useValue: mockOutbox },
        { provide: ThreadCategoriesService, useValue: mockCategories },
        {
          provide: MediaReferenceService,
          useValue: {
            syncPostContent: jest.fn().mockResolvedValue(undefined),
            syncDraftContent: jest.fn().mockResolvedValue(undefined),
            releasePostContent: jest.fn().mockResolvedValue(undefined),
            releaseDraftContent: jest.fn().mockResolvedValue(undefined),
            releaseSubthreadContent: jest.fn().mockResolvedValue(undefined),
            releaseThreadContent: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StickerContentService,
          useValue: {
            assertContentAllowed: jest.fn().mockResolvedValue([]),
            recordUsage: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    postsService = module.get(PostsService);
    subthreadsService = module.get(SubthreadsService);
    threadsService = module.get(ThreadsService);
    membersService = module.get(ThreadMembersService);

    setupHelpers.mockThreadAccess_pass(prisma);
  });

  // ======================== 第一部分：主题帖草稿生命周期 ========================
  describe('主题帖草稿 (Thread Draft)', () => {
    it('创建草稿：published=false，自动创建 OWNER 成员', async () => {
      const tx = setupThreadTransaction(prisma);
      prisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        title: '测试标题',
        category: 'RPG',
        published: false,
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [],
        topicTags: [],
        _count: { members: 1, posts: 0 },
      });

      const result = await threadsService.create({ title: '测试标题', category: 'RPG' }, 'u1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('t1');
      expect(tx.thread.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: '测试标题', published: false }),
        }),
      );
      expect(tx.threadMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: 'OWNER', playerMarked: true }),
        }),
      );
      expect(mockNotificationProducer.notify).not.toHaveBeenCalled();
    });

    it('创建草稿：无标题时 title 默认为未命名草稿', async () => {
      const tx = setupThreadTransaction(prisma);
      prisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        owner: {},
        subthreads: [],
        topicTags: [],
        _count: {},
      });

      await threadsService.create({}, 'u1');
      expect(tx.thread.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ title: '未命名草稿' }) }),
      );
    });

    it('创建草稿：携带标签应同步创建 TopicTag', async () => {
      const tx = setupThreadTransaction(prisma);
      mockTags.findOrCreate.mockResolvedValue([
        { id: 'tag1', name: '科幻' },
        { id: 'tag2', name: '悬疑' },
      ]);
      prisma.threadTopicTag.createMany.mockResolvedValue({ count: 2 });
      prisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        owner: {},
        subthreads: [],
        topicTags: [],
        _count: {},
      });

      await threadsService.create(
        { title: '测试', category: 'RPG', tagNames: ['科幻', '悬疑'] },
        'u1',
      );
      expect(mockTags.findOrCreate).toHaveBeenCalledWith(
        ['科幻', '悬疑'],
        expect.objectContaining({ thread: tx.thread }),
      );
      expect(prisma.threadTopicTag.createMany).toHaveBeenCalled();
    });

    it('草稿列表：仅返回用户的未发布帖', async () => {
      prisma.thread.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      const result = await threadsService.findDrafts('u1');
      expect(result).toHaveLength(2);
      expect(prisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'u1', published: false, deletedAt: null } }),
      );
    });

    it('公开列表：仅展示已发布 + 公开帖', async () => {
      prisma.thread.findMany.mockResolvedValue([]);
      await threadsService.findAll({ sort: 'newest' });
      expect(prisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ published: true, visibility: 'PUBLIC' }),
        }),
      );
    });

    it('公开列表：filter=playing 仅返回 playing 帖', async () => {
      prisma.thread.findMany.mockResolvedValue([]);
      await threadsService.findAll({ sort: 'newest', filter: 'playing' }, 'u1');
      expect(prisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            published: true,
            members: { some: { userId: 'u1', playerMarked: true } },
          }),
        }),
      );
    });

    it('detail：已发布公开帖在 Redis 增加 viewCount，但不刷新主题帖更新时间', async () => {
      const thread = {
        id: 't1',
        title: '测试',
        published: true,
        visibility: 'PUBLIC',
        owner: { id: 'u1' },
        subthreads: [],
      };
      prisma.thread.findUnique.mockResolvedValue(thread);
      const result = await threadsService.findById('t1');
      expect(result.id).toBe('t1');
      expect(mockRedis.hincrbyAtLeast).toHaveBeenCalledWith('thread:t1:stats', 'views', 0, 1);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.thread.update).not.toHaveBeenCalled();
    });

    it('detail：未发布帖非 owner 返回 404', async () => {
      prisma.thread.findUnique.mockResolvedValue({ id: 't1', published: false, ownerId: 'u1' });
      await expect(threadsService.findById('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('detail：未发布帖未登录返回 404', async () => {
      prisma.thread.findUnique.mockResolvedValue({ id: 't1', published: false, ownerId: 'u1' });
      await expect(threadsService.findById('t1')).rejects.toThrow(BusinessException);
    });

    it('detail：未发布帖 owner 可查看', async () => {
      const thread = {
        id: 't1',
        published: false,
        ownerId: 'u1',
        visibility: 'PUBLIC',
        owner: { id: 'u1' },
        subthreads: [],
      };
      prisma.thread.findUnique.mockResolvedValue(thread);
      const result = await threadsService.findById('t1', 'u1');
      expect(result.id).toBe('t1');
    });

    it('detail：已发布私密帖非成员返回 404', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        published: true,
        visibility: 'PRIVATE',
      });
      prisma.threadMember.findUnique.mockResolvedValue(null);
      prisma.thread.update.mockResolvedValue({});
      await expect(threadsService.findById('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('detail：已发布私密帖成员可查看', async () => {
      const thread = {
        id: 't1',
        published: true,
        visibility: 'PRIVATE',
        owner: { id: 'u1' },
        subthreads: [],
      };
      prisma.thread.findUnique.mockResolvedValue(thread);
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      prisma.thread.update.mockResolvedValue({});
      const result = await threadsService.findById('t1', 'u3');
      expect(result.id).toBe('t1');
    });

    it('detail：主题帖不存在返回 404', async () => {
      prisma.thread.findUnique.mockResolvedValue(null);
      await expect(threadsService.findById('x')).rejects.toThrow(BusinessException);
    });
  });

  // ======================== 第二部分：发布流程 ========================
  describe('发布流程 (Publish)', () => {
    it('发布成功：title + category + subthread + post 齐备 → 通知粉丝', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.findUnique
        .mockResolvedValueOnce({ visibility: 'PUBLIC', published: false, ownerId: 'u1' }) // assertAccessible
        .mockResolvedValueOnce({
          published: false,
          title: '测试',
          category: 'RPG',
          defaultSubthread: { id: 's1', posts: [{ content: '正文' }] },
        });
      prisma.thread.update.mockResolvedValue({
        id: 't1',
        title: '测试',
        category: 'RPG',
        published: true,
        publishedAt: new Date(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date(),
        viewCount: 0,
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [],
        topicTags: [],
        _count: { members: 1, posts: 1 },
      });
      prisma.userFollow.findMany.mockResolvedValue([{ followerId: 'f1' }, { followerId: 'f2' }]);

      const result = await threadsService.update('t1', { version: 1, published: true }, 'u1');
      expect(result.published).toBe(true);
      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'thread.published',
          eventKey: 'thread-published:t1',
        }),
      );
    });

    it('发布失败：无标题', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        published: false,
        ownerId: 'u1',
        title: '',
        category: 'DEDUCTION',
        defaultSubthread: null,
      });
      await expect(
        threadsService.update('t1', { version: 1, published: true }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('发布失败：无分区', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        published: false,
        ownerId: 'u1',
        title: '测试',
        category: undefined,
        defaultSubthread: null,
      });
      await expect(
        threadsService.update('t1', { version: 1, published: true }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('发布失败：无子贴', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        published: false,
        ownerId: 'u1',
        title: '测试',
        category: 'RPG',
        defaultSubthread: null,
      });
      prisma.subthread.findFirst.mockResolvedValue(null);
      await expect(
        threadsService.update('t1', { version: 1, published: true }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('发布失败：子贴中无正文', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.findUnique
        .mockResolvedValueOnce({ visibility: 'PUBLIC', published: false, ownerId: 'u1' })
        .mockResolvedValueOnce({
          published: false,
          title: '测试',
          category: 'RPG',
          defaultSubthread: { id: 's1', posts: [] },
        });
      await expect(
        threadsService.update('t1', { version: 1, published: true }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('已发布帖不能再次发布', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        published: true,
        ownerId: 'u1',
        title: '测试',
        category: 'RPG',
        defaultSubthread: null,
      });
      await expect(
        threadsService.update('t1', { version: 1, published: true }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('发布时 title 取自 updateData 而非 thread.title', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.findUnique
        .mockResolvedValueOnce({ visibility: 'PUBLIC', published: false, ownerId: 'u1' })
        .mockResolvedValueOnce({
          published: false,
          title: '旧标题',
          category: 'DEDUCTION',
          defaultSubthread: { id: 's1', posts: [{ content: '正文' }] },
        });
      prisma.thread.update.mockResolvedValue({
        id: 't1',
        title: '新标题',
        category: 'DEDUCTION',
        published: true,
        publishedAt: new Date(),
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date(),
        viewCount: 0,
        owner: { id: 'u1', username: 'test', avatar: null },
        subthreads: [],
        topicTags: [],
        _count: { members: 1, posts: 1 },
      });
      prisma.userFollow.findMany.mockResolvedValue([]);

      const result = await threadsService.update(
        't1',
        { version: 1, published: true, title: '新标题' },
        'u1',
      );
      expect(result.title).toBe('新标题');
    });
  });

  // ======================== 第三部分：子贴生命周期 ========================
  describe('子贴 (Subthread)', () => {
    it('创建子贴：含正文 → 创建子贴 + kind=BODY 正文帖（无楼层号）+ 发射事件', async () => {
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.thread.findUnique.mockResolvedValue({ published: true, title: '主题A' });
      prisma.$transaction.mockImplementation(async (fn: unknown) => {
        const tx = {
          ...basicTx(),
          subthread: {
            ...basicTx().subthread,
            aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: -1 } }),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 's1', threadId: 't1', sortOrder: 0 }),
            findUnique: jest
              .fn()
              .mockResolvedValue({ id: 's1', threadId: 't1', tags: [], _count: { posts: 1 } }),
          },
          post: {
            create: jest.fn().mockResolvedValue({
              id: 'p1',
              kind: 'BODY',
              floorNumber: null,
              content: '正文',
              author: { username: 'test' },
              diceRolls: [],
            }),
          },
        };
        return invokeTransaction(fn, tx);
      });

      const result = await subthreadsService.create(
        't1',
        { title: '设定区', content: '正文' },
        'u1',
      );
      expect(result!.id).toBe('s1');
      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'post.created',
          payload: expect.objectContaining({ isSubthreadBody: true }),
        }),
      );
    });

    it('创建子贴：不含正文 → 仅创建子贴，不创建楼层，不发射事件', async () => {
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.thread.findUnique.mockResolvedValue({ published: true, title: '主题A' });
      prisma.$transaction.mockImplementation(async (fn: unknown) => {
        const tx = {
          ...basicTx(),
          subthread: {
            ...basicTx().subthread,
            aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 1 } }),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 's2', threadId: 't1', sortOrder: 2 }),
            findUnique: jest
              .fn()
              .mockResolvedValue({ id: 's2', threadId: 't1', tags: [], _count: { posts: 0 } }),
          },
          post: { create: jest.fn() },
        };
        return invokeTransaction(fn, tx);
      });

      await subthreadsService.create('t1', { title: '空白区' }, 'u1');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('subthread.created', expect.any(Object));
    });

    it('创建子贴：未发布帖创建含正文子贴 → 不发射事件', async () => {
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        published: false,
        ownerId: 'u1',
        title: '草稿帖',
      });
      prisma.$transaction.mockImplementation(async (fn: unknown) => {
        const tx = {
          ...basicTx(),
          subthread: {
            ...basicTx().subthread,
            aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 's1', threadId: 't1', sortOrder: 1 }),
            findUnique: jest
              .fn()
              .mockResolvedValue({ id: 's1', threadId: 't1', tags: [], _count: { posts: 1 } }),
          },
          post: {
            create: jest.fn().mockResolvedValue({
              id: 'p1',
              kind: 'BODY',
              floorNumber: null,
              content: '正文',
              author: { username: 'test' },
              diceRolls: [],
            }),
          },
        };
        return invokeTransaction(fn, tx);
      });

      await subthreadsService.create('t1', { title: '设定区', content: '正文' }, 'u1');
      expect(mockOutbox.enqueue).not.toHaveBeenCalled();
    });

    it('创建子贴：指定 sortOrder 冲突 → 409', async () => {
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.thread.findUnique.mockResolvedValue({ published: true, title: '主题A' });
      prisma.$transaction.mockImplementation(async (fn: unknown) => {
        const tx = {
          ...basicTx(),
          subthread: {
            ...basicTx().subthread,
            aggregate: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({ id: 'existing', sortOrder: 2 }),
            create: jest.fn(),
            findUnique: jest.fn(),
          },
        };
        return invokeTransaction(fn, tx);
      });

      await expect(
        subthreadsService.create('t1', { title: '设定区', sortOrder: 2, content: '正文' }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('创建子贴：非管理权限 → 403', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      await expect(subthreadsService.create('t1', { title: '设定区' }, 'u2')).rejects.toThrow(
        BusinessException,
      );
    });

    it('排序：空列表 → 拒绝', async () => {
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      await expect(subthreadsService.reorder('t1', [], 'u1')).rejects.toThrow(BusinessException);
    });

    it('排序：首项非默认子贴 → 拒绝', async () => {
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.subthread.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prisma.thread.findUnique.mockResolvedValue({ defaultSubthreadId: 'a' }); // 默认是 a，首项是 b
      await expect(subthreadsService.reorder('t1', ['b', 'a'], 'u1')).rejects.toThrow(
        BusinessException,
      );
    });

    it('排序：含不存在子贴 → 拒绝', async () => {
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.subthread.findMany.mockResolvedValue([{ id: 'a' }]);
      await expect(subthreadsService.reorder('t1', ['a', 'b'], 'u1')).rejects.toThrow(
        BusinessException,
      );
    });

    it('排序：正常批量排 → 成功', async () => {
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.subthread.findMany
        .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
        .mockResolvedValueOnce([
          { id: 'a', title: 'sA', sortOrder: 0 },
          { id: 'b', title: 'sB', sortOrder: 1 },
          { id: 'c', title: 'sC', sortOrder: 2 },
        ]);
      prisma.subthread.findFirst.mockResolvedValue({ id: 'a' });
      prisma.$transaction.mockImplementation(async (fn: unknown) => {
        const tx = {
          $queryRaw: jest.fn(),
          thread: { findUnique: jest.fn().mockResolvedValue({ defaultSubthreadId: 'a' }) },
          subthread: {
            findMany: prisma.subthread.findMany,
            update: jest.fn(),
          },
        };
        return invokeTransaction(fn, tx);
      });
      const result = await subthreadsService.reorder('t1', ['a', 'b', 'c'], 'u1');
      expect(result).toHaveLength(3);
    });

    it('子贴列表：应过滤已软删除', async () => {
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.subthread.findMany.mockResolvedValue([]);
      await subthreadsService.findAll('t1');
      expect(prisma.subthread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { threadId: 't1', deletedAt: null } }),
      );
    });

    it('子贴详情：不存在返回 404', async () => {
      prisma.subthread.findUnique.mockResolvedValue(null);
      await expect(subthreadsService.findById('x')).rejects.toThrow(BusinessException);
    });

    it('修改：默认子贴不可修改 sortOrder', async () => {
      prisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.thread.findUnique
        .mockResolvedValueOnce({ visibility: 'PUBLIC', published: true, ownerId: 'u1' })
        .mockResolvedValueOnce({ defaultSubthreadId: 's1' });
      await expect(
        subthreadsService.update('s1', { version: 1, sortOrder: 5 }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('删除：已软删子贴返回 404', async () => {
      prisma.subthread.findUnique.mockResolvedValue(null);
      await expect(subthreadsService.remove('s1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('删除：默认子贴不可删除', async () => {
      prisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', deletedAt: null });
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.thread.findUnique
        .mockResolvedValueOnce({ visibility: 'PUBLIC', published: true, ownerId: 'u1' })
        .mockResolvedValueOnce({ defaultSubthreadId: 's1' });
      await expect(subthreadsService.remove('s1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('删除：非默认子贴应设置 deletedAt', async () => {
      prisma.subthread.findUnique.mockResolvedValue({ id: 's2', threadId: 't1', deletedAt: null });
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.thread.findUnique
        .mockResolvedValueOnce({ visibility: 'PUBLIC', published: true, ownerId: 'u1' })
        .mockResolvedValueOnce({ defaultSubthreadId: 's1' }); // 默认是 s1
      prisma.subthread.update.mockResolvedValue({ id: 's2', deletedAt: new Date() });
      await subthreadsService.remove('s2', 'u1');
      expect(prisma.subthread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, id: 's2' },
          data: { deletedAt: expect.any(Date) },
        }),
      );
    });
  });

  // ======================== 第四部分：楼层发帖 ========================
  describe('楼层创建 (Post Create)', () => {
    it('创建新楼层：floorNumber 应为 MAX+1', async () => {
      setupHelpers.mockSubthread_find(prisma);
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.threadMember.upsert.mockResolvedValue({});
      setupHelpers.mockThreadMember_participant(prisma);
      setupHelpers.mockPost_create_withFloor(prisma, 5);

      const result = await postsService.create('s1', { content: 'test' }, 'u1');
      expect(result.floorNumber).toBe(6);
    });

    it('创建楼中楼回复：floorNumber 应为 null，parentPostId 设置为父楼层', async () => {
      setupHelpers.mockSubthread_find(prisma);
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      prisma.post.findUnique.mockResolvedValue({ id: 'p1', subthreadId: 's1', parentPostId: null });
      const txFn = (fn: unknown) =>
        invokeTransaction(fn, {
          ...basicTx(),
          post: {
            aggregate: jest.fn(),
            create: jest.fn().mockResolvedValue({
              id: 'p2',
              floorNumber: null,
              parentPostId: 'p1',
              content: 'reply',
              author: { id: 'u2', username: 'user2' },
            }),
          },
        });
      prisma.$transaction.mockImplementation(txFn);

      const result = await postsService.create(
        's1',
        { content: 'reply', parentPostId: 'p1' },
        'u2',
      );
      expect(result.floorNumber).toBeNull();
      expect(result.parentPostId).toBe('p1');
    });

    it('创建回复：replyToPostId 指定目标，不设置 floorNumber', async () => {
      setupHelpers.mockSubthread_find(prisma);
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      prisma.post.findUnique
        .mockResolvedValueOnce({ id: 'p_parent', subthreadId: 's1', parentPostId: null }) // parentPostId 校验
        .mockResolvedValueOnce({ id: 'p_target', subthreadId: 's1' }); // replyToPostId 校验
      prisma.$transaction.mockImplementation(async (fn: unknown) =>
        invokeTransaction(fn, {
          ...basicTx(),
          post: {
            aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 3 } }),
            create: jest.fn().mockResolvedValue({
              id: 'p3',
              floorNumber: null,
              parentPostId: 'p_parent',
              replyToPostId: 'p_target',
              content: 'reply',
              author: { id: 'u2', username: 'user2' },
            }),
          },
        }),
      );

      const result = await postsService.create(
        's1',
        { content: 'reply', parentPostId: 'p_parent', replyToPostId: 'p_target' },
        'u2',
      );
      expect(result.floorNumber).toBeNull();
    });

    it('创建回复：replyToPostId 引用不存在的帖子 → 404', async () => {
      setupHelpers.mockSubthread_find(prisma);
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      prisma.post.findUnique.mockResolvedValueOnce(null); // replyToPostId not found
      await expect(
        postsService.create('s1', { content: 'reply', replyToPostId: 'x' }, 'u2'),
      ).rejects.toThrow(BusinessException);
    });

    it('创建回复：replyToPostId 跨子贴 → error', async () => {
      setupHelpers.mockSubthread_find(prisma);
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      prisma.post.findUnique.mockResolvedValue({ id: 'p_target', subthreadId: 's_other' });
      await expect(
        postsService.create('s1', { content: 'reply', replyToPostId: 'p_target' }, 'u2'),
      ).rejects.toThrow(BusinessException);
    });

    it('创建回复：不存在的父楼层 → 404', async () => {
      setupHelpers.mockSubthread_find(prisma);
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      prisma.post.findUnique.mockResolvedValue(null);
      await expect(
        postsService.create('s1', { content: 'reply', parentPostId: 'x' }, 'u2'),
      ).rejects.toThrow(BusinessException);
    });

    it('自动加入：非成员发帖时自动成为 PARTICIPANT', async () => {
      setupHelpers.mockSubthread_find(prisma);
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.threadMember.upsert.mockResolvedValue({});
      setupHelpers.mockThreadMember_participant(prisma);
      setupHelpers.mockPost_create_withFloor(prisma, 0);

      await postsService.create('s1', { content: 'test' }, 'u2');
      expect(prisma.threadMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { threadId_userId: { threadId: 't1', userId: 'u2' } },
          create: { threadId: 't1', userId: 'u2', role: 'PARTICIPANT' },
        }),
      );
    });

    it('发帖到不存在的子贴 → 404', async () => {
      prisma.subthread.findUnique.mockResolvedValue(null);
      await expect(postsService.create('x', { content: 'test' }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  // ======================== 第五部分：发帖权限策略 ========================
  describe('发帖权限 (Posting Policy)', () => {
    it('COLLABORATORS：非协作者 → 403', async () => {
      setupHelpers.mockSubthread_find(prisma, { postingPolicy: 'COLLABORATORS' });
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      await expect(postsService.create('s1', { content: 'test' }, 'u2')).rejects.toThrow(
        BusinessException,
      );
    });

    it('COLLABORATORS：OWNER → 通过', async () => {
      setupHelpers.mockSubthread_find(prisma, { postingPolicy: 'COLLABORATORS' });
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      setupHelpers.mockPost_create_withFloor(prisma, 3);
      const result = await postsService.create('s1', { content: 'test' }, 'u1');
      expect(result.floorNumber).toBe(4);
    });

    it('COLLABORATORS：COLLABORATOR → 通过', async () => {
      setupHelpers.mockSubthread_find(prisma, { postingPolicy: 'COLLABORATORS' });
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'COLLABORATOR' });
      setupHelpers.mockPost_create_withFloor(prisma, 3);
      const result = await postsService.create('s1', { content: 'test' }, 'u2');
      expect(result.floorNumber).toBe(4);
    });

    it('PLAYERS：非玩家 → 403', async () => {
      setupHelpers.mockSubthread_find(prisma, { postingPolicy: 'PLAYERS' });
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({
        role: 'PARTICIPANT',
        playerMarked: false,
      });
      await expect(postsService.create('s1', { content: 'test' }, 'u2')).rejects.toThrow(
        BusinessException,
      );
    });

    it('PLAYERS：玩家 → 通过', async () => {
      setupHelpers.mockSubthread_find(prisma, { postingPolicy: 'PLAYERS' });
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT', playerMarked: true });
      setupHelpers.mockPost_create_withFloor(prisma, 1);
      const result = await postsService.create('s1', { content: 'test' }, 'u2');
      expect(result.floorNumber).toBe(2);
    });

    it('PARTICIPANTS：任何成员 → 通过', async () => {
      setupHelpers.mockSubthread_find(prisma);
      prisma.threadMember.upsert.mockResolvedValue({});
      setupHelpers.mockThreadMember_participant(prisma);
      setupHelpers.mockPost_create_withFloor(prisma, 0);
      const result = await postsService.create('s1', { content: 'test' }, 'u2');
      expect(result.floorNumber).toBe(1);
    });
  });

  // ======================== 第六部分：事件发射 ========================
  describe('事件发射 (Event Emission)', () => {
    it('已发布帖发楼层：触发 post.created 事件', async () => {
      const subthread = {
        id: 's1',
        threadId: 't1',
        title: '子贴A',
        postingPolicy: 'PARTICIPANTS' as const,
        thread: { published: true, title: '主题A' },
      };
      prisma.subthread.findUnique.mockResolvedValue(subthread);
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      prisma.$transaction.mockImplementation(async (fn: unknown) =>
        invokeTransaction(fn, {
          ...basicTx(),
          post: {
            aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 10 } }),
            create: jest.fn().mockResolvedValue({
              id: 'p11',
              floorNumber: 11,
              content: 'test',
              author: { id: 'u1', username: 'test' },
            }),
          },
        }),
      );

      await postsService.create('s1', { content: 'test' }, 'u1');
      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'post.created',
          payload: expect.objectContaining({
            postId: 'p11',
            content: 'test',
            userId: 'u1',
            threadId: 't1',
            subthreadId: 's1',
            parentPostId: null,
          }),
        }),
      );
    });

    it('未发布帖发楼层：不触发事件', async () => {
      const subthread = {
        id: 's1',
        threadId: 't1',
        title: '子贴A',
        postingPolicy: 'PARTICIPANTS' as const,
        thread: { published: false, title: '草稿帖' },
      };
      prisma.subthread.findUnique.mockResolvedValue(subthread);
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.$transaction.mockImplementation(async (fn: unknown) =>
        invokeTransaction(fn, {
          ...basicTx(),
          post: {
            aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 0 } }),
            create: jest.fn().mockResolvedValue({
              id: 'p1',
              floorNumber: 1,
              content: 'test',
              author: { id: 'u1', username: 'test' },
            }),
          },
        }),
      );

      await postsService.create('s1', { content: 'test' }, 'u1');
      expect(mockOutbox.enqueue).not.toHaveBeenCalled();
    });

    it('已发布帖发楼中楼：parentPostId 非空时仍应触发事件', async () => {
      const subthread = {
        id: 's1',
        threadId: 't1',
        title: '子贴A',
        postingPolicy: 'PARTICIPANTS' as const,
        thread: { published: true, title: '主题A' },
      };
      prisma.subthread.findUnique.mockResolvedValue(subthread);
      prisma.threadMember.upsert.mockResolvedValue({});
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      prisma.post.findUnique.mockResolvedValue({ id: 'p1', subthreadId: 's1', parentPostId: null });
      prisma.$transaction.mockImplementation(async (fn: unknown) =>
        invokeTransaction(fn, {
          ...basicTx(),
          post: {
            aggregate: jest.fn(),
            create: jest.fn().mockResolvedValue({
              id: 'p2',
              floorNumber: null,
              parentPostId: 'p1',
              content: 'reply',
              author: { id: 'u2', username: 'user2' },
            }),
          },
        }),
      );

      await postsService.create('s1', { content: 'reply', parentPostId: 'p1' }, 'u2');
      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: 'post.created',
          payload: expect.objectContaining({ parentPostId: 'p1' }),
        }),
      );
    });
  });

  // ======================== 第七部分：帖子编辑 ========================
  describe('帖子编辑 (Post Edit)', () => {
    it('编辑自己的帖子 → 成功', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        threadId: 't1',
        content: '旧内容',
        subthread: { deletedAt: null },
      });
      prisma.post.update.mockResolvedValue({
        id: 'p1',
        content: '编辑后',
        author: { username: 'test' },
      });
      prisma.post.findUniqueOrThrow.mockResolvedValue({
        id: 'p1',
        content: '编辑后',
        author: { username: 'test' },
        diceRolls: [],
      });
      const result = await postsService.update('p1', { version: 1, content: '编辑后' }, 'u1');
      expect(result.content).toBe('编辑后');
    });

    it('编辑他人的帖子 → 403', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        subthread: { deletedAt: null },
      });
      await expect(postsService.update('p1', { version: 1, content: 'x' }, 'u2')).rejects.toThrow(
        BusinessException,
      );
    });

    it('编辑已删除帖子 → 404', async () => {
      prisma.post.findUnique.mockResolvedValue(null);
      await expect(postsService.update('p1', { version: 1, content: 'x' }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });

    it('编辑：乐观锁版本号检查', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        threadId: 't1',
        content: '旧',
        subthread: { deletedAt: null },
      });
      prisma.post.update.mockRejectedValue(
        Object.assign(new Error('Not found'), { code: 'P2025' }),
      );
      await expect(postsService.update('p1', { content: 'x', version: 1 }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  // ======================== 第十二部分：乐观锁 ========================
  describe('乐观锁 (Optimistic Lock)', () => {
    it('编辑主题帖：版本冲突 → 409', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.update.mockRejectedValue(
        Object.assign(new Error('Not found'), { code: 'P2025' }),
      );
      await expect(postsService.update('p1', { content: 'x', version: 1 }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  // ======================== 第八部分：帖子删除 ========================
  describe('帖子删除 (Post Delete)', () => {
    it('软删除非第一楼 → 成功', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        kind: 'FLOOR',
        floorNumber: 3,
        parentPostId: 'p0',
        threadId: 't1',
        subthread: { deletedAt: null },
      });
      prisma.post.update.mockResolvedValue({ id: 'p1', deletedAt: new Date() });
      await postsService.remove('p1', 'u1');
      expect(prisma.post.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, id: 'p1' },
          data: {
            deletedAt: expect.any(Date),
            removalSource: 'AUTHOR',
            removedById: 'u1',
          },
        }),
      );
    });

    it('删除他人帖子 → 403', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        subthread: { deletedAt: null },
      });
      await expect(postsService.remove('p1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('删除主体正文（kind=BODY）→ 403', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        kind: 'BODY',
        parentPostId: null,
        threadId: 't1',
        subthread: { deletedAt: null },
      });
      await expect(postsService.remove('p1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('删除楼层（kind=FLOOR 带 parentPostId）→ 成功（楼中楼不受影响）', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        kind: 'FLOOR',
        floorNumber: 1,
        parentPostId: 'p_parent',
        threadId: 't1',
        subthread: { deletedAt: null },
      });
      prisma.post.update.mockResolvedValue({ id: 'p1', deletedAt: new Date() });
      await postsService.remove('p1', 'u1');
      expect(prisma.post.update).toHaveBeenCalled();
    });

    it('删除已删除帖子 → 404', async () => {
      prisma.post.findUnique.mockResolvedValue(null);
      await expect(postsService.remove('p1', 'u1')).rejects.toThrow(BusinessException);
    });
  });

  // ======================== 第九部分：帖子查询 ========================
  describe('帖子查询 (Post Query)', () => {
    it('findAllBySubthread：返回楼层列表', async () => {
      prisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.post.findMany.mockResolvedValue([{ id: 'p1', author: {}, _count: { replies: 2 } }]);
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await postsService.findAllBySubthread('s1');
      expect(result.items[0].id).toBe('p1');
    });

    it('findAllBySubthread：已软删子贴返回 404', async () => {
      prisma.subthread.findUnique.mockResolvedValue(null);
      await expect(postsService.findAllBySubthread('x')).rejects.toThrow(BusinessException);
    });

    it('findReplies：返回楼中楼列表带 replyToPost', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        threadId: 't1',
        kind: 'FLOOR',
        parentPostId: null,
        subthread: { deletedAt: null },
      });
      setupHelpers.mockThreadAccess_pass(prisma);
      prisma.post.findMany.mockResolvedValue([{ id: 'p2', author: {}, replyToPost: null }]);
      const result = await postsService.findReplies('p1');
      expect(result.items[0].id).toBe('p2');
    });

    it('findReplies：已软删子贴返回 404', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        threadId: 't1',
        subthread: { deletedAt: new Date() },
      });
      await expect(postsService.findReplies('p1')).rejects.toThrow(BusinessException);
    });

    it('findById：返回帖子详情含导航上下文', async () => {
      prisma.post.findUnique
        .mockResolvedValueOnce({ id: 'p1', threadId: 't1', subthread: { deletedAt: null } })
        .mockResolvedValueOnce({
          id: 'p1',
          author: {},
          thread: {},
          subthread: {},
          parentPost: null,
          replyToPost: null,
          _count: { replies: 0 },
        });
      setupHelpers.mockThreadAccess_pass(prisma);
      const result = await postsService.findById('p1');
      expect(result.id).toBe('p1');
    });

    it('findById：不存在的帖子返回 404', async () => {
      prisma.post.findUnique.mockResolvedValue(null);
      await expect(postsService.findById('x')).rejects.toThrow(BusinessException);
    });

    it('findById：已软删子贴中的帖子返回 404', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        threadId: 't1',
        subthread: { deletedAt: new Date() },
      });
      await expect(postsService.findById('p1')).rejects.toThrow(BusinessException);
    });
  });

  // ======================== 第十一部分：主题帖删除 ========================
  describe('主题帖删除 (Thread Delete)', () => {
    it('未发布草稿：硬删除（级联）', async () => {
      prisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: false });
      prisma.thread.delete.mockResolvedValue({ id: 't1' });
      await threadsService.remove('t1', 'u1');
      expect(prisma.thread.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(prisma.thread.update).not.toHaveBeenCalled();
    });

    it('已发布帖：软删除', async () => {
      prisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true });
      prisma.thread.update.mockResolvedValue({ id: 't1', deletedAt: new Date() });
      await threadsService.remove('t1', 'u1');
      expect(prisma.thread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            deletedAt: expect.any(Date),
            removalSource: 'OWNER',
            removedById: 'u1',
          },
        }),
      );
      expect(prisma.thread.delete).not.toHaveBeenCalled();
    });

    it('仅楼主可删除', async () => {
      prisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true });
      await expect(threadsService.remove('t1', 'u2')).rejects.toThrow(BusinessException);
    });
  });

  // ======================== 第十二部分：邀请链接 ========================
  describe('邀请链接 (Invite Link)', () => {
    it('私密已发布帖：正常生成', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        ownerId: 'u1',
        published: true,
        visibility: 'PRIVATE',
      });
      prisma.threadInvite.upsert.mockResolvedValue({
        id: 'inv1',
        threadId: 't1',
        token: 'abc123def456gh78',
      });
      const result = await threadsService.createInviteLink('t1', 'u1');
      expect(result.token).toBeDefined();
    });

    it('公开帖：禁止生成', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        ownerId: 'u1',
        published: true,
        visibility: 'PUBLIC',
      });
      await expect(threadsService.createInviteLink('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('未发布帖：禁止生成', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        ownerId: 'u1',
        published: false,
        visibility: 'PRIVATE',
      });
      await expect(threadsService.createInviteLink('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('预览邀请链接：正常返回帖子概要', async () => {
      prisma.threadInvite.findUnique.mockResolvedValue({
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
      prisma.threadMember.count.mockResolvedValue(3);
      const result = await threadsService.previewInviteLink('token123');
      expect(result.thread.title).toBe('奇幻大陆');
      expect(result.thread.memberCount).toBe(3);
    });

    it('预览邀请链接：无效 token → 404', async () => {
      prisma.threadInvite.findUnique.mockResolvedValue(null);
      await expect(threadsService.previewInviteLink('bad')).rejects.toThrow(BusinessException);
    });

    it('预览邀请链接：公开帖拒绝', async () => {
      prisma.threadInvite.findUnique.mockResolvedValue({
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
      await expect(threadsService.previewInviteLink('token123')).rejects.toThrow(BusinessException);
    });

    it('通过邀请链接加入：成功', async () => {
      prisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', visibility: 'PRIVATE', published: true },
      });
      prisma.threadMember.upsert.mockResolvedValue({ id: 'm1', thread: {}, user: {} });
      const result = await threadsService.joinByInviteLink('token123', 'u2');
      expect(result.id).toBe('m1');
    });

    it('通过邀请链接加入：未发布帖拒绝', async () => {
      prisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', visibility: 'PRIVATE', published: false },
      });
      await expect(threadsService.joinByInviteLink('token123', 'u2')).rejects.toThrow(
        BusinessException,
      );
    });

    it('通过邀请链接加入：已是成员时幂等返回已有记录', async () => {
      prisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1',
        thread: { id: 't1', visibility: 'PRIVATE', published: true },
      });
      prisma.threadMember.upsert.mockResolvedValue({
        id: 'existing',
        thread: { id: 't1' },
        user: { id: 'u2' },
      });
      await expect(threadsService.joinByInviteLink('token123', 'u2')).resolves.toMatchObject({
        id: 'existing',
      });
      expect(prisma.threadMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
    });

    it('通过邀请链接加入：无效token → 404', async () => {
      prisma.threadInvite.findUnique.mockResolvedValue(null);
      await expect(threadsService.joinByInviteLink('bad', 'u2')).rejects.toThrow(BusinessException);
    });
  });

  // ======================== 第十四部分：断言权限 ========================
  describe('权限断言 (Assert Permissions)', () => {
    it('assertCanManage: OWNER → 通过', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      await expect(threadsService.assertCanManage('t1', 'u1')).resolves.toBeDefined();
      await expect(subthreadsService.assertCanManage('t1', 'u1')).resolves.toBeDefined();
    });

    it('assertCanManage: COLLABORATOR → 通过', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'COLLABORATOR' });
      await expect(threadsService.assertCanManage('t1', 'u1')).resolves.toBeDefined();
    });

    it('assertCanManage: PARTICIPANT → 403', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      await expect(threadsService.assertCanManage('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('assertCanManage: 非成员 → 403', async () => {
      prisma.threadMember.findUnique.mockResolvedValue(null);
      await expect(threadsService.assertCanManage('t1', 'u1')).rejects.toThrow(BusinessException);
    });
  });

  // ======================== 第十五部分：成员管理 ========================
  describe('成员管理 (Thread Members)', () => {
    it('公开帖自由加入 → 成功', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        id: 't1',
        visibility: 'PUBLIC',
        published: true,
      });
      prisma.threadMember.findUnique.mockResolvedValue(null);
      prisma.threadMember.create.mockResolvedValue({ id: 'm1' });
      const result = await membersService.join('t1', 'u1');
      expect(result.id).toBe('m1');
    });

    it('私密帖禁止自由加入', async () => {
      prisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PRIVATE' });
      await expect(membersService.join('t1', 'u1')).rejects.toThrow(BusinessException);
    });
  });

  // ======================== 第十六部分：@提及 ========================
  describe('@提及 (Mentions)', () => {
    let mentionsService: MentionsService;

    beforeEach(async () => {
      const mod = await Test.createTestingModule({
        providers: [
          MentionsService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: ThreadAccessService,
            useValue: { assertAccessible: jest.fn().mockResolvedValue(undefined) },
          },
          { provide: BlockFilterService, useValue: mockBlockFilter },
        ],
      }).compile();
      mentionsService = mod.get(MentionsService);
    });

    it('解析 @用户名', () => {
      const names = mentionsService.extractUsernames('你好 @张三 和 @李四，还有 @john_doe');
      expect(names).toContain('张三');
      expect(names).toContain('李四');
      expect(names).toContain('john_doe');
    });

    it('重复 @用户名去重', () => {
      const names = mentionsService.extractUsernames('@张三 又 @张三 见');
      expect(names.filter((n) => n === '张三')).toHaveLength(1);
    });

    it('@自己不应产生提及记录', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1', username: '张三' }]);
      const result = await mentionsService.parseAndCreate('p1', '你好 @张三', 'u1', 't1');
      expect(result).toHaveLength(0);
    });

    it('无 @ 正文应返回空', async () => {
      const result = await mentionsService.parseAndCreate('p1', '普通内容', 'u1', 't1');
      expect(result).toHaveLength(0);
    });

    it('解析并创建 PostMention 记录', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u2', username: '张三' },
        { id: 'u3', username: '李四' },
      ]);
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.userFollow.findMany.mockResolvedValue([]);
      prisma.threadMember.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }]);
      prisma.postMention.findMany.mockResolvedValue([]);
      prisma.postMention.createMany.mockResolvedValue({ count: 2 });
      const result = await mentionsService.parseAndCreate('p1', '你好 @张三 和 @李四', 'u1', 't1');
      expect(result).toHaveLength(2);
    });
  });

  // ======================== 第十七部分：优化锁集成 ========================
  describe('乐观锁 (Optimistic Lock)', () => {
    it('编辑主题帖：版本冲突 → 409', async () => {
      prisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.thread.update.mockRejectedValue(
        Object.assign(new Error('Not found'), { code: 'P2025' }),
      );
      await expect(
        threadsService.update('t1', { title: '新标题', version: 1 }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('编辑子贴：版本冲突 → 409', async () => {
      prisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
      setupHelpers.mockThreadMember_ownerOrCollab(prisma);
      prisma.subthread.findFirst.mockResolvedValue({ id: 's0' });
      prisma.subthread.update.mockRejectedValue(
        Object.assign(new Error('Not found'), { code: 'P2025' }),
      );
      await expect(
        subthreadsService.update('s1', { title: '新标题', version: 1 }, 'u1'),
      ).rejects.toThrow(BusinessException);
    });

    it('编辑帖子：版本冲突 → 409', async () => {
      prisma.post.findUnique.mockResolvedValue({
        id: 'p1',
        authorId: 'u1',
        threadId: 't1',
        content: '旧',
        subthread: { deletedAt: null },
      });
      prisma.post.update.mockRejectedValue(
        Object.assign(new Error('Not found'), { code: 'P2025' }),
      );
      await expect(postsService.update('p1', { content: 'x', version: 1 }, 'u1')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  // ======================== 第十八部分：ThreadAccess 边界 ========================
  describe('ThreadAccess 访问控制', () => {
    it('已删除主题帖 → 404', async () => {
      prisma.thread.findUnique.mockResolvedValue(null);
      await expect(postsService.findAllBySubthread('s1')).rejects.toThrow(BusinessException);
    });

    it('未发布帖非 owner → 404', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        published: false,
        ownerId: 'u1',
      });
      await expect(postsService.findAllBySubthread('s1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('未发布帖未登录 → 404', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PUBLIC',
        published: false,
        ownerId: 'u1',
      });
      await expect(postsService.findAllBySubthread('s1')).rejects.toThrow(BusinessException);
    });

    it('私密帖非成员 → 404', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PRIVATE',
        published: true,
        ownerId: 'u1',
      });
      prisma.threadMember.findUnique.mockResolvedValue(null);
      await expect(postsService.findAllBySubthread('s1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('私密帖未登录 → 404', async () => {
      prisma.thread.findUnique.mockResolvedValue({
        visibility: 'PRIVATE',
        published: true,
        ownerId: 'u1',
      });
      await expect(postsService.findAllBySubthread('s1')).rejects.toThrow(BusinessException);
    });
  });
});
