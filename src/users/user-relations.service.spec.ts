import { NotFoundException } from '@nestjs/common';
import { UserRelationsService } from './user-relations.service';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSummarySelect } from '../common/user-summary';
import { OutboxService } from '../outbox/outbox.service';

describe('UserRelationsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    userFollow: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    userBlock: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
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
    await expect(service.userFollowing('missing')).rejects.toThrow(NotFoundException);
  });

  it('公开关注列表使用安全用户摘要', async () => {
    prisma.userFollow.findMany.mockResolvedValue([{ id: 'f1' }]);
    await service.userFollowing('target');
    expect(prisma.userFollow.findMany).toHaveBeenCalledWith({
      where: { followerId: 'target' },
      include: { following: { select: publicUserSummarySelect } },
    });
  });
});
