import { ThreadQueryService } from './thread-query.service';

const cachedThread = {
  id: 't1',
  ownerId: 'owner-1',
  title: '公开主题帖',
  published: true,
  visibility: 'PUBLIC',
  deletedAt: null,
  categoryInfo: { slug: 'STORY_ROOM', name: '叙事剧场', isActive: true },
  viewCount: 12,
  subthreads: [
    { id: 's1', postingPolicy: 'PARTICIPANTS' },
    { id: 's2', postingPolicy: 'COLLABORATORS' },
  ],
};

describe('ThreadQueryService.findById 当前用户权限投影', () => {
  const prisma = {
    userBookmark: { findUnique: jest.fn() },
    threadLike: { findUnique: jest.fn() },
    threadMember: { findUnique: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  };
  const access = { assertAccessible: jest.fn() };
  const redis = { hincrbyAtLeast: jest.fn() };
  const cache = {
    buildKey: jest.fn(() => 'thread:t1'),
    get: jest.fn(),
    set: jest.fn(),
  };
  const postingPolicy = {
    attachToThread: jest.fn(async (thread: typeof cachedThread) => ({
      ...thread,
      subthreads: thread.subthreads.map((subthread) => ({
        ...subthread,
        postingCapability: { canPost: true, denialReason: null },
      })),
    })),
  };
  const service = new ThreadQueryService(
    prisma as never,
    access as never,
    redis as never,
    cache as never,
    postingPolicy as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.assertAccessible.mockResolvedValue(undefined);
    cache.get.mockResolvedValue(cachedThread);
    redis.hincrbyAtLeast.mockResolvedValue(13);
    prisma.userBookmark.findUnique.mockResolvedValue(null);
    prisma.threadLike.findUnique.mockResolvedValue(null);
    prisma.threadMember.findUnique.mockResolvedValue(null);
    prisma.threadMember.groupBy.mockResolvedValue([]);
    postingPolicy.attachToThread.mockClear();
  });

  it('匿名访问不查询成员列表，也不暴露管理能力', async () => {
    const result = await service.findById('t1');

    expect(prisma.threadMember.findUnique).not.toHaveBeenCalled();
    expect(result.currentMembership).toBeNull();
    expect(postingPolicy.attachToThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
    );
    expect(result.capabilities).toEqual({
      isOwner: false,
      canManageThread: false,
      canManageMembers: false,
    });
  });

  it('只查询当前用户成员关系并投影协作者能力', async () => {
    prisma.threadMember.findUnique.mockResolvedValue({
      id: 'm1',
      userId: 'collaborator-1',
      role: 'COLLABORATOR',
      playerMarked: true,
    });

    const result = await service.findById('t1', 'collaborator-1');

    expect(prisma.threadMember.findUnique).toHaveBeenCalledWith({
      where: {
        threadId_userId: { userId: 'collaborator-1', threadId: 't1' },
      },
      select: { id: true, userId: true, role: true, playerMarked: true },
    });
    expect(result.currentMembership).toMatchObject({ role: 'COLLABORATOR' });
    expect(postingPolicy.attachToThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      'collaborator-1',
      expect.objectContaining({ role: 'COLLABORATOR' }),
    );
    expect(result.capabilities).toEqual({
      isOwner: false,
      canManageThread: true,
      canManageMembers: true,
    });
  });

  it('帖主即使成员关系缺失也拥有管理能力', async () => {
    const result = await service.findById('t1', 'owner-1');

    expect(result.capabilities).toEqual({
      isOwner: true,
      canManageThread: true,
      canManageMembers: true,
    });
  });

  describe('findMyCollaboratedThreads', () => {
    const card = (id: string, updatedAt: Date, visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC') => ({
      id,
      title: `主题 ${id}`,
      category: null,
      categoryDefinition: null,
      status: 'RECRUITING',
      visibility,
      published: true,
      pinned: false,
      tipTotal: 0n,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt,
      deletedAt: null,
      owner: { id: 'owner', username: '楼主', avatar: null, level: 1, deletedAt: null },
      defaultSubthread: null,
      topicTags: [],
      _count: { members: 2, posts: 0 },
    });

    it('只查询 COLLABORATOR 的已发布未删除主题，公开与私密均不额外过滤', async () => {
      prisma.threadMember.findMany.mockResolvedValue([
        { thread: card('private-thread', new Date('2026-08-23T10:00:00.000Z'), 'PRIVATE') },
        { thread: card('public-thread', new Date('2026-08-23T09:00:00.000Z')) },
      ]);

      const result = await service.findMyCollaboratedThreads('collaborator', undefined, 20);

      expect(result.items.map((item) => item.id)).toEqual(['private-thread', 'public-thread']);
      expect(prisma.threadMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'collaborator',
            role: 'COLLABORATOR',
            thread: { published: true, deletedAt: null },
          },
          orderBy: [{ thread: { updatedAt: 'desc' } }, { thread: { id: 'desc' } }],
          take: 21,
        }),
      );
    });

    it('时间与 ID 复合游标稳定推进，且任免后的下一次查询立即反映成员关系', async () => {
      const sameTime = new Date('2026-08-23T12:00:00.000Z');
      prisma.threadMember.findMany
        .mockResolvedValueOnce([
          { thread: card('thread-b', sameTime) },
          { thread: card('thread-a', sameTime) },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ thread: card('thread-c', sameTime) }]);

      const first = await service.findMyCollaboratedThreads('user', undefined, 2);
      const decoded = JSON.parse(
        Buffer.from(first.pagination.cursor!, 'base64url').toString('utf8'),
      );
      expect(decoded).toEqual({ updatedAt: sameTime.toISOString(), id: 'thread-a' });

      await service.findMyCollaboratedThreads('user', first.pagination.cursor!, 2);
      expect(prisma.threadMember.findMany.mock.calls[1][0].where.thread.OR).toEqual([
        { updatedAt: { lt: sameTime } },
        { updatedAt: sameTime, id: { lt: 'thread-a' } },
      ]);

      const afterRoleChange = await service.findMyCollaboratedThreads('user', undefined, 2);
      expect(afterRoleChange.items.map((item) => item.id)).toEqual(['thread-c']);
      expect(cache.get).not.toHaveBeenCalledWith(expect.stringContaining('collaborated'));
    });

    it('非法游标返回 INVALID_CURSOR(40007)', async () => {
      await expect(service.findMyCollaboratedThreads('user', 'not-json', 20)).rejects.toMatchObject(
        {
          errorCode: 40007,
          status: 400,
        },
      );
      expect(prisma.threadMember.findMany).not.toHaveBeenCalled();
    });
  });
});
