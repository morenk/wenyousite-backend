import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersFollowController } from './users-follow.controller';
import { publicUserSummarySelect } from '../common/user-summary';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { BlockFilterService } from '../common/services/block-filter.service';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  userFollow: { findMany: jest.fn() },
  userBlock: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
};

describe('UsersFollowController（公开关注/粉丝列表）', () => {
  let controller: UsersFollowController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersFollowController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationProducer, useValue: { notify: jest.fn() } },
        { provide: BlockFilterService, useValue: { loadBlockSets: jest.fn().mockResolvedValue({ blocked: new Set(), blocking: new Set() }), filterRecipients: jest.fn((ids: string[]) => ids) } },
      ],
    }).compile();
    controller = module.get<UsersFollowController>(UsersFollowController);
    jest.clearAllMocks();
  });

  it('userFollowing 返回目标用户的关注列表', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    const follow = [{ id: 'f1', followerId: 'u1', followingId: 'u2', createdAt: new Date(), following: { id: 'u2', username: 'b', avatar: null } }];
    mockPrisma.userFollow.findMany.mockResolvedValue(follow);

    const result = await controller.userFollowing('u1');

    expect(mockPrisma.userFollow.findMany).toHaveBeenCalledWith({
      where: { followerId: 'u1' },
      include: { following: { select: publicUserSummarySelect } },
    });
    expect(result).toEqual(follow);
  });

  it('userFollowers 返回目标用户的粉丝列表', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    const follow = [{ id: 'f1', followerId: 'u2', followingId: 'u1', createdAt: new Date(), follower: { id: 'u2', username: 'a', avatar: null } }];
    mockPrisma.userFollow.findMany.mockResolvedValue(follow);

    const result = await controller.userFollowers('u1');

    expect(mockPrisma.userFollow.findMany).toHaveBeenCalledWith({
      where: { followingId: 'u1' },
      include: { follower: { select: publicUserSummarySelect } },
    });
    expect(result).toEqual(follow);
  });

  it('目标用户不存在时返回 404', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(controller.userFollowing('x')).rejects.toThrow(NotFoundException);
    await expect(controller.userFollowers('x')).rejects.toThrow(NotFoundException);
  });
});
