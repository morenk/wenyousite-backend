import { ThreadQueryService } from './thread-query.service';

const cachedThread = {
  id: 't1',
  ownerId: 'owner-1',
  title: '公开主题帖',
  published: true,
  visibility: 'PUBLIC',
  deletedAt: null,
  viewCount: 12,
};

describe('ThreadQueryService.findById 当前用户权限投影', () => {
  const prisma = {
    userBookmark: { findUnique: jest.fn() },
    threadLike: { findUnique: jest.fn() },
    threadMember: { findUnique: jest.fn() },
  };
  const access = { assertAccessible: jest.fn() };
  const redis = { hincrbyAtLeast: jest.fn() };
  const cache = {
    buildKey: jest.fn(() => 'thread:t1'),
    get: jest.fn(),
    set: jest.fn(),
  };
  const service = new ThreadQueryService(
    prisma as never,
    access as never,
    redis as never,
    cache as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.assertAccessible.mockResolvedValue(undefined);
    cache.get.mockResolvedValue(cachedThread);
    redis.hincrbyAtLeast.mockResolvedValue(13);
    prisma.userBookmark.findUnique.mockResolvedValue(null);
    prisma.threadLike.findUnique.mockResolvedValue(null);
    prisma.threadMember.findUnique.mockResolvedValue(null);
  });

  it('匿名访问不查询成员列表，也不暴露管理能力', async () => {
    const result = await service.findById('t1');

    expect(prisma.threadMember.findUnique).not.toHaveBeenCalled();
    expect(result.currentMembership).toBeNull();
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
});
