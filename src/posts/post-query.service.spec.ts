import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { PostQueryService } from './post-query.service';

const prisma = {
  $queryRaw: jest.fn(),
  subthread: { findUnique: jest.fn() },
  threadMember: { findMany: jest.fn(), findUnique: jest.fn() },
  post: { findMany: jest.fn(), findUnique: jest.fn() },
};

const threadAccess = {
  assertAccessible: jest.fn(),
};

describe('PostQueryService.findAllBySubthread', () => {
  let service: PostQueryService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.subthread.findUnique.mockResolvedValue({
      id: 'subthread-1',
      threadId: 'thread-1',
      thread: { ownerId: 'owner-user-id' },
    });
    prisma.post.findMany.mockResolvedValue([]);
    prisma.threadMember.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    threadAccess.assertAccessible.mockResolvedValue(undefined);
    service = new PostQueryService(
      prisma as unknown as PrismaService,
      threadAccess as unknown as ThreadAccessService,
    );
  });

  it('未筛选时保持既有主楼条件、默认排序、游标和响应行为', async () => {
    prisma.post.findMany.mockResolvedValue([
      { id: 'floor-1', _count: { replies: 0 } },
      { id: 'floor-2', _count: { replies: 0 } },
    ]);

    const result = await service.findAllBySubthread('subthread-1');

    expect(prisma.threadMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          subthreadId: 'subthread-1',
          kind: 'FLOOR',
          parentPostId: null,
          deletedAt: null,
        },
        orderBy: { floorNumber: 'asc' },
        take: 21,
        cursor: undefined,
        skip: 0,
      }),
    );
    expect(result).toMatchObject({
      items: [
        { id: 'floor-1', replies: [] },
        { id: 'floor-2', replies: [] },
      ],
      pagination: { cursor: 'floor-2', hasMore: false },
    });
  });

  it.each([
    ['楼主', 'owner-user-id', null],
    ['协作者', 'collaborator-user-id', { role: 'COLLABORATOR', playerMarked: false }],
    ['玩家', 'player-user-id', { role: 'PARTICIPANT', playerMarked: true }],
  ] as const)('支持按%s筛选主楼层', async (_label, authorId, member) => {
    if (member) prisma.threadMember.findUnique.mockResolvedValue(member);
    prisma.post.findMany.mockResolvedValue([
      { id: 'floor-filtered', authorId, _count: { replies: 0 } },
    ]);

    const result = await service.findAllBySubthread(
      'subthread-1',
      undefined,
      20,
      undefined,
      ReplyOrder.OLDEST,
      authorId,
    );

    expect(result.items).toHaveLength(1);
    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subthreadId: 'subthread-1',
          kind: 'FLOOR',
          parentPostId: null,
          authorId,
        }),
      }),
    );
    if (authorId === 'owner-user-id') {
      expect(prisma.threadMember.findUnique).not.toHaveBeenCalled();
    } else {
      expect(prisma.threadMember.findUnique).toHaveBeenCalledWith({
        where: { threadId_userId: { threadId: 'thread-1', userId: authorId } },
        select: { role: true, playerMarked: true },
      });
    }
  });

  it('普通参与者不进入可选角色范围并返回空页', async () => {
    prisma.threadMember.findUnique.mockResolvedValue({
      role: 'PARTICIPANT',
      playerMarked: false,
    });

    const result = await service.findAllBySubthread(
      'subthread-1',
      undefined,
      20,
      undefined,
      ReplyOrder.OLDEST,
      'participant-user-id',
    );

    expect(result).toEqual({
      items: [],
      pagination: { cursor: null, hasMore: false },
    });
    expect(prisma.post.findMany).not.toHaveBeenCalled();
  });

  it('作者筛选与倒序游标分页保持在同一主楼查询范围', async () => {
    prisma.threadMember.findUnique.mockResolvedValue({
      role: 'COLLABORATOR',
      playerMarked: false,
    });
    prisma.post.findMany.mockResolvedValue([
      { id: 'floor-5', _count: { replies: 0 } },
      { id: 'floor-4', _count: { replies: 0 } },
      { id: 'floor-3', _count: { replies: 0 } },
    ]);

    const result = await service.findAllBySubthread(
      'subthread-1',
      'floor-6',
      2,
      'viewer-user-id',
      ReplyOrder.NEWEST,
      'collaborator-user-id',
    );

    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ authorId: 'collaborator-user-id' }),
        orderBy: { floorNumber: 'desc' },
        take: 3,
        cursor: { id: 'floor-6' },
        skip: 1,
      }),
    );
    expect(result).toMatchObject({
      items: [{ id: 'floor-5' }, { id: 'floor-4' }],
      pagination: { cursor: 'floor-4', hasMore: true },
    });
  });

  it('只筛选主楼层，内嵌楼中楼预览继续返回其他作者', async () => {
    prisma.threadMember.findUnique.mockResolvedValue({
      role: 'COLLABORATOR',
      playerMarked: false,
    });
    prisma.$queryRaw.mockResolvedValue([{ id: 'reply-other-author' }]);
    prisma.post.findMany
      .mockResolvedValueOnce([
        {
          id: 'floor-filtered',
          authorId: 'collaborator-user-id',
          _count: { replies: 1 },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'reply-other-author',
          parentPostId: 'floor-filtered',
          authorId: 'other-user-id',
        },
      ]);

    const result = await service.findAllBySubthread(
      'subthread-1',
      undefined,
      20,
      undefined,
      ReplyOrder.OLDEST,
      'collaborator-user-id',
    );

    expect(prisma.post.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ authorId: 'collaborator-user-id' }),
      }),
    );
    expect(prisma.post.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: { in: ['reply-other-author'] } },
      }),
    );
    expect(result.items[0]).toMatchObject({
      id: 'floor-filtered',
      replies: [{ id: 'reply-other-author', authorId: 'other-user-id' }],
    });
  });

  it('主楼层作者候选只保留当前子贴实际发言的楼主、协作者和玩家', async () => {
    prisma.post.findMany.mockResolvedValue([
      {
        authorId: 'player-user-id',
        author: { id: 'player-user-id', username: '甲玩家', avatar: null, level: 2 },
      },
      {
        authorId: 'participant-user-id',
        author: { id: 'participant-user-id', username: '普通参与者', avatar: null, level: 1 },
      },
      {
        authorId: 'owner-user-id',
        author: { id: 'owner-user-id', username: '楼主', avatar: null, level: 3 },
      },
      {
        authorId: 'collaborator-user-id',
        author: { id: 'collaborator-user-id', username: '协作者', avatar: null, level: 2 },
      },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([
      { userId: 'player-user-id', role: 'PARTICIPANT', playerMarked: true },
      { userId: 'participant-user-id', role: 'PARTICIPANT', playerMarked: false },
      { userId: 'collaborator-user-id', role: 'COLLABORATOR', playerMarked: false },
    ]);

    const result = await service.findFloorAuthors('subthread-1', 'viewer-user-id');

    expect(prisma.post.findMany).toHaveBeenCalledWith({
      where: {
        subthreadId: 'subthread-1',
        kind: 'FLOOR',
        parentPostId: null,
        deletedAt: null,
      },
      distinct: ['authorId'],
      select: {
        authorId: true,
        author: {
          select: { id: true, username: true, avatar: true, level: true, deletedAt: true },
        },
      },
    });
    expect(result).toEqual([
      {
        id: 'owner-user-id',
        username: '楼主',
        avatar: null,
        level: 3,
        role: 'OWNER',
        playerMarked: false,
      },
      {
        id: 'collaborator-user-id',
        username: '协作者',
        avatar: null,
        level: 2,
        role: 'COLLABORATOR',
        playerMarked: false,
      },
      {
        id: 'player-user-id',
        username: '甲玩家',
        avatar: null,
        level: 2,
        role: 'PARTICIPANT',
        playerMarked: true,
      },
    ]);
  });

  it('楼中楼作者候选只查询当前父楼层下的存活回复', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'floor-1',
      threadId: 'thread-1',
      kind: 'FLOOR',
      parentPostId: null,
      thread: { ownerId: 'owner-user-id' },
      subthread: { deletedAt: null },
    });
    prisma.post.findMany.mockResolvedValue([
      {
        authorId: 'player-user-id',
        author: { id: 'player-user-id', username: '当前楼玩家', avatar: null, level: 2 },
      },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([
      { userId: 'player-user-id', role: 'PARTICIPANT', playerMarked: true },
    ]);

    const result = await service.findReplyAuthors('floor-1', 'viewer-user-id');

    expect(prisma.post.findMany).toHaveBeenCalledWith({
      where: { parentPostId: 'floor-1', deletedAt: null },
      distinct: ['authorId'],
      select: {
        authorId: true,
        author: {
          select: { id: true, username: true, avatar: true, level: true, deletedAt: true },
        },
      },
    });
    expect(result).toEqual([
      {
        id: 'player-user-id',
        username: '当前楼玩家',
        avatar: null,
        level: 2,
        role: 'PARTICIPANT',
        playerMarked: true,
      },
    ]);
  });

  it('消息深链指向存活回复时，若父楼层已删除也返回不存在', async () => {
    prisma.post.findUnique.mockResolvedValueOnce({
      id: 'reply-1',
      threadId: 'thread-1',
      parentPost: { deletedAt: new Date() },
      subthread: { deletedAt: null },
    });

    await expect(service.findById('reply-1', 'viewer-user-id')).rejects.toMatchObject({
      errorCode: expect.any(Number),
    });
    expect(threadAccess.assertAccessible).not.toHaveBeenCalled();
  });
});
