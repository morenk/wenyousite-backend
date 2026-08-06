import { DiceService } from '../dice/dice.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ThreadAggregateService } from './thread-aggregate.service';

function makeCurrent(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    title: '未命名草稿',
    category: 'RPG',
    published: false,
    version: 3,
    defaultSubthreadId: 's1',
    defaultSubthread: {
      id: 's1',
      title: '主帖',
      version: 2,
      posts: [],
    },
    ...overrides,
  };
}

function makeUpdated() {
  return {
    id: 't1',
    title: '新标题',
    ownerId: 'u1',
    category: 'RPG',
    status: 'RECRUITING',
    visibility: 'PUBLIC',
    published: true,
    publishedAt: new Date(),
    pinned: false,
    pinnedAt: null,
    viewCount: 0,
    version: 4,
    likeCount: 0,
    defaultSubthreadId: 's1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    owner: { id: 'u1', username: 'owner', avatar: null },
    subthreads: [
      {
        id: 's1',
        threadId: 't1',
        title: '新标题',
        version: 3,
        posts: [{ id: 'p1', kind: 'BODY', content: '正文', version: 1, diceRolls: [] }],
        tags: [],
        _count: { posts: 1 },
      },
    ],
    topicTags: [{ tag: { id: 'tag1', name: '奇幻', color: null } }],
    _count: { members: 1, posts: 1 },
  };
}

describe('ThreadAggregateService', () => {
  const access = {
    assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER', playerMarked: true }),
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const eventEmitter = { emit: jest.fn() };
  const redis = {
    zadd: jest.fn().mockResolvedValue(1),
    hset: jest.fn().mockResolvedValue(1),
  };
  const mentions = { syncMentions: jest.fn().mockResolvedValue([]) };
  const blockFilter = {
    loadBlockSets: jest.fn(),
    filterRecipients: jest.fn(),
  };
  const notifications = { notify: jest.fn() };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    thread: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    subthread: { update: jest.fn().mockResolvedValue({}) },
    post: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    diceRoll: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    topicTag: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn(),
    },
    threadTopicTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    threadMember: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    threadMember: { groupBy: jest.fn().mockResolvedValue([{ threadId: 't1', _count: 1 }]) },
  };
  const service = new ThreadAggregateService(
    prisma as never,
    access as never,
    new DiceService(),
    outbox as never,
    eventEmitter as never,
    redis as never,
    mentions as never,
    blockFilter as never,
    notifications as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.assertCanManage.mockResolvedValue({ role: 'OWNER', playerMarked: true });
    prisma.$transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
    prisma.threadMember.groupBy.mockResolvedValue([{ threadId: 't1', _count: 1 }]);
    tx.thread.findUnique.mockResolvedValue(makeCurrent());
    tx.thread.update.mockResolvedValue(makeUpdated());
    tx.post.create.mockResolvedValue({ id: 'p1', author: { username: 'owner' } });
    tx.post.findMany.mockResolvedValue([
      {
        id: 'p1',
        kind: 'BODY',
        content: '正文',
        authorId: 'u1',
        author: { username: 'owner' },
        subthreadId: 's1',
        subthread: { title: '新标题' },
        parentPostId: null,
        replyToPostId: null,
      },
    ]);
    tx.threadMember.findMany.mockResolvedValue([
      { userId: 'u1', role: 'OWNER', playerMarked: true },
    ]);
    tx.topicTag.findMany.mockResolvedValue([{ id: 'tag1', name: '奇幻' }]);
  });

  it('在单个事务中保存元数据、默认正文、标签并发布', async () => {
    const result = await service.save(
      't1',
      {
        title: '新标题',
        category: 'RPG',
        visibility: 'PUBLIC',
        published: true,
        version: 3,
        defaultSubthreadVersion: 2,
        content: '正文',
        tagNames: ['奇幻'],
      },
      'u1',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.subthread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: '新标题', version: { increment: 1 } } }),
    );
    expect(tx.post.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: '正文', kind: 'BODY' }) }),
    );
    expect(tx.threadTopicTag.createMany).toHaveBeenCalledWith({
      data: [{ threadId: 't1', tagId: 'tag1' }],
      skipDuplicates: true,
    });
    expect(tx.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 't1', version: 3 }),
        data: expect.objectContaining({ published: true, version: { increment: 1 } }),
      }),
    );
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    const mappedSubthread = result.subthreads[0] as (typeof result.subthreads)[number] & {
      bodyPost?: { content: string };
    };
    expect(mappedSubthread.bodyPost?.content).toBe('正文');
  });

  it('任一正文版本冲突时拒绝整个聚合保存', async () => {
    tx.thread.findUnique.mockResolvedValue(
      makeCurrent({
        defaultSubthread: {
          id: 's1',
          title: '主帖',
          version: 2,
          posts: [
            {
              id: 'p1',
              content: '旧正文',
              version: 5,
              author: { username: 'owner' },
              diceRolls: [],
            },
          ],
        },
      }),
    );

    await expect(
      service.save(
        't1',
        {
          version: 3,
          defaultSubthreadVersion: 2,
          bodyVersion: 4,
          content: '新正文',
          tagNames: [],
        },
        'u1',
      ),
    ).rejects.toMatchObject({ errorCode: 40002 });
    expect(tx.thread.update).not.toHaveBeenCalled();
    expect(tx.threadTopicTag.deleteMany).not.toHaveBeenCalled();
  });

  it('协作者不能借聚合端点修改楼主专属可见性', async () => {
    access.assertCanManage.mockResolvedValue({ role: 'COLLABORATOR', playerMarked: false });

    await expect(
      service.save(
        't1',
        {
          visibility: 'PRIVATE',
          version: 3,
          defaultSubthreadVersion: 2,
          content: '正文',
          tagNames: [],
        },
        'u2',
      ),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
