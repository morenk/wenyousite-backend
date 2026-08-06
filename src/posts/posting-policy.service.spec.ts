import { PostingPolicyService } from './posting-policy.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PostingPolicyService', () => {
  const prisma = {
    userBlock: { findFirst: jest.fn() },
  };
  let service: PostingPolicyService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userBlock.findFirst.mockResolvedValue(null);
    service = new PostingPolicyService(prisma as unknown as PrismaService);
  });

  it('同时检查楼主拉黑用户和用户拉黑楼主', async () => {
    await service.assertCanPost({
      ownerId: 'owner',
      userId: 'author',
      postingPolicy: 'PARTICIPANTS',
      member: null,
    });

    expect(prisma.userBlock.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { blockerId: 'owner', blockedId: 'author' },
          { blockerId: 'author', blockedId: 'owner' },
        ],
      },
      select: { id: true },
    });
  });

  it('任一方向存在拉黑时拒绝发帖', async () => {
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'block' });
    await expect(
      service.assertCanPost({
        ownerId: 'owner',
        userId: 'author',
        postingPolicy: 'PARTICIPANTS',
        member: null,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('PLAYERS 允许已标记玩家，拒绝普通参与者', async () => {
    await expect(
      service.assertCanPost({
        ownerId: 'owner',
        userId: 'author',
        postingPolicy: 'PLAYERS',
        member: { role: 'PARTICIPANT', playerMarked: true },
      }),
    ).resolves.toBeUndefined();

    await expect(
      service.assertCanPost({
        ownerId: 'owner',
        userId: 'author',
        postingPolicy: 'PLAYERS',
        member: { role: 'PARTICIPANT', playerMarked: false },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('协作者不受玩家标记限制', async () => {
    await expect(
      service.assertCanPost({
        ownerId: 'owner',
        userId: 'collaborator',
        postingPolicy: 'PLAYERS',
        member: { role: 'COLLABORATOR', playerMarked: false },
      }),
    ).resolves.toBeUndefined();
  });
});
