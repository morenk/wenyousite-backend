import { UserRelationsService } from './user-relations.service';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSummarySelect } from '../common/user-summary';
import { OutboxService } from '../outbox/outbox.service';
import { ErrorCode } from '../common/exceptions/error-codes';

describe('UserRelationsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    userFollow: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    userBlock: {
      findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    directConversation: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    directMessage: { deleteMany: jest.fn() },
  };
  const outbox = { enqueue: jest.fn() };
  let service: UserRelationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'target' });
    prisma.userFollow.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    outbox.enqueue.mockResolvedValue(undefined);
    service = new UserRelationsService(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxService,
    );
  });

  it('首次关注使用唯一约束幂等写入并发送一次通知', async () => {
    await expect(service.follow({ id: 'actor', username: 'A' }, 'target')).resolves.toEqual({
      message: '已关注',
    });
    expect(prisma.userFollow.createMany).toHaveBeenCalledWith({
      data: [{ followerId: 'actor', followingId: 'target' }],
      skipDuplicates: true,
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        eventType: 'user.followed',
        payload: expect.objectContaining({ actorId: 'actor', targetId: 'target' }),
      }),
    );
  });

  it('重复关注不重复发送通知', async () => {
    prisma.userFollow.createMany.mockResolvedValue({ count: 0 });
    await service.follow({ id: 'actor' }, 'target');
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('目标用户不存在返回 404', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.userFollowing('missing')).rejects.toMatchObject({
      errorCode: ErrorCode.USER_NOT_FOUND,
    });
  });

  it('公开关注列表使用安全用户摘要', async () => {
    prisma.userFollow.findMany.mockResolvedValue([{ id: 'f1' }]);
    await service.userFollowing('target');
    expect(prisma.userFollow.findMany).toHaveBeenCalledWith({
      where: { followerId: 'target', following: { deletedAt: null } },
      include: { following: { select: publicUserSummarySelect } },
    });
  });

  it.each(['unfollow', 'removeFollower'] as const)('%s 在同一事务持锁后删除且不发送事件', async (operation) => {
    const sequence: string[] = [];
    prisma.$queryRaw.mockImplementation(async () => { sequence.push('lock'); return []; });
    prisma.userFollow.deleteMany.mockImplementation(async () => { sequence.push('delete'); return { count: 0 }; });

    await expect(service[operation]('actor', 'target')).resolves.toEqual({
      message: operation === 'unfollow' ? '已取消关注' : '已移除粉丝',
    });
    expect(sequence).toEqual(['lock', 'delete']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.userFollow.deleteMany).toHaveBeenCalledWith({
      where: operation === 'unfollow'
        ? { followerId: 'actor', followingId: 'target' }
        : { followerId: 'target', followingId: 'actor' },
    });
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('关注持有与删除相同的有序双用户行锁', async () => {
    await service.follow({ id: 'actor' }, 'target');
    const followLock = prisma.$queryRaw.mock.calls[0][0];
    prisma.$queryRaw.mockClear();
    await service.removeFollower('actor', 'target');
    const removalLock = prisma.$queryRaw.mock.calls[0][0];
    expect(removalLock.values).toEqual(followLock.values);
    expect(removalLock.sql).toEqual(followLock.sql);
    expect(removalLock.sql).toContain('ORDER BY id FOR UPDATE');
  });

  it('本人关注列表批量返回单向和互关状态，公开本人入口相同', async () => {
    const records = [{ followingId: 'a' }, { followingId: 'b' }];
    prisma.userFollow.findMany.mockResolvedValueOnce(records).mockResolvedValueOnce([{ followerId: 'b' }]);
    await expect(service.userFollowing('actor', 'actor')).resolves.toEqual([
      { followingId: 'a', viewerIsFollowing: true, viewerIsFollowedBy: false },
      { followingId: 'b', viewerIsFollowing: true, viewerIsFollowedBy: true },
    ]);
    expect(prisma.userFollow.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.userFollow.findMany).toHaveBeenLastCalledWith({
      where: { followingId: 'actor', followerId: { in: ['a', 'b'] } },
      select: { followerId: true },
    });
  });

  it('本人粉丝列表批量返回回关状态', async () => {
    prisma.userFollow.findMany.mockResolvedValueOnce([{ followerId: 'a' }, { followerId: 'b' }])
      .mockResolvedValueOnce([{ followingId: 'a' }]);
    await expect(service.userFollowers('actor', 'actor')).resolves.toEqual([
      { followerId: 'a', viewerIsFollowing: true, viewerIsFollowedBy: true },
      { followerId: 'b', viewerIsFollowing: false, viewerIsFollowedBy: true },
    ]);
    expect(prisma.userFollow.findMany).toHaveBeenCalledTimes(2);
  });

  it.each(['following', 'followers'] as const)('%s 空列表不额外查询', async (operation) => {
    prisma.userFollow.findMany.mockResolvedValue([]);
    await expect(service[operation]('actor', 'actor')).resolves.toEqual([]);
    expect(prisma.userFollow.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['following', undefined], ['following', 'viewer'], ['followers', undefined], ['followers', 'viewer'],
  ] as const)('%s 非本人查看者 %s 不获得管理投影', async (operation, viewerId) => {
    const records = [{ id: 'relationship' }];
    prisma.userFollow.findMany.mockResolvedValue(records);
    await expect(service[operation]('owner', viewerId)).resolves.toEqual(records);
    expect(prisma.userFollow.findMany).toHaveBeenCalledTimes(1);
  });

  it('拉黑保留待处理私聊请求与首条消息', async () => {
    prisma.directConversation.findUnique.mockResolvedValue({ id: 'c1', status: 'PENDING' });
    prisma.directConversation.updateMany.mockResolvedValue({ count: 1 });
    prisma.directMessage.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.block('actor', 'target')).resolves.toEqual({ message: '已拉黑' });

    expect(prisma.userBlock.upsert).toHaveBeenCalled();
    expect(prisma.directConversation.updateMany).not.toHaveBeenCalled();
    expect(prisma.directMessage.deleteMany).not.toHaveBeenCalled();
  });

  it('拉黑与接受请求并发时不覆盖已接受会话，也不删除历史消息', async () => {
    prisma.directConversation.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.directConversation.updateMany.mockResolvedValue({ count: 0 });

    await service.block('actor', 'target');

    expect(prisma.directConversation.updateMany).not.toHaveBeenCalled();
    expect(prisma.directMessage.deleteMany).not.toHaveBeenCalled();
  });
});
