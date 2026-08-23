import { PostingPolicy, MemberRole } from '@prisma/client';
import { PostingPolicyService } from './posting-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';

const policies: PostingPolicy[] = ['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'];

describe('PostingPolicyService 发言能力与写入判定', () => {
  const prisma = {
    userBlock: { findFirst: jest.fn() },
  };
  let service: PostingPolicyService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userBlock.findFirst.mockResolvedValue(null);
    service = new PostingPolicyService(prisma as unknown as PrismaService);
  });

  it.each(policies)('游客在 %s 策略下均需登录', (postingPolicy) => {
    expect(
      service.evaluate({
        ownerId: 'owner',
        postingPolicy,
        member: null,
        blockedRelation: false,
      }),
    ).toEqual({ canPost: false, denialReason: 'AUTHENTICATION_REQUIRED' });
  });

  it.each([
    ['OWNER', 'owner', { role: 'OWNER', playerMarked: true }],
    ['COLLABORATOR', 'manager', { role: 'COLLABORATOR', playerMarked: false }],
  ] as const)('%s 在三种策略下展示与写入均允许', async (_label, userId, member) => {
    for (const postingPolicy of policies) {
      expect(
        service.evaluate({
          ownerId: 'owner',
          userId,
          postingPolicy,
          member,
          blockedRelation: false,
        }),
      ).toEqual({ canPost: true, denialReason: null });
      await expect(
        service.assertCanPost({ ownerId: 'owner', userId, postingPolicy, member }),
      ).resolves.toBeUndefined();
    }
  });

  it.each([
    ['PARTICIPANTS', true, null, undefined],
    ['PLAYERS', true, null, undefined],
    ['COLLABORATORS', false, 'COLLABORATOR_REQUIRED', ErrorCode.NOT_COLLABORATOR],
  ] as const)(
    '玩家在 %s 策略下能力与楼层/回复写入保持一致',
    async (postingPolicy, canPost, denialReason, errorCode) => {
      const member = { role: 'PARTICIPANT' as MemberRole, playerMarked: true };
      expect(
        service.evaluate({
          ownerId: 'owner',
          userId: 'player',
          postingPolicy,
          member,
          blockedRelation: false,
        }),
      ).toEqual({ canPost, denialReason });
      const write = service.assertCanPost({
        ownerId: 'owner',
        userId: 'player',
        postingPolicy,
        member,
      });
      if (canPost) await expect(write).resolves.toBeUndefined();
      else await expect(write).rejects.toMatchObject({ errorCode });
    },
  );

  it.each([
    ['PARTICIPANTS', true, null, undefined],
    ['COLLABORATORS', false, 'COLLABORATOR_REQUIRED', ErrorCode.NOT_COLLABORATOR],
    ['PLAYERS', false, 'PLAYER_REQUIRED', ErrorCode.NOT_PLAYER],
  ] as const)(
    '普通登录用户在 %s 策略下能力与楼层/回复写入保持一致',
    async (postingPolicy, canPost, denialReason, errorCode) => {
      const member = { role: 'PARTICIPANT' as MemberRole, playerMarked: false };
      expect(
        service.evaluate({
          ownerId: 'owner',
          userId: 'participant',
          postingPolicy,
          member,
          blockedRelation: false,
        }),
      ).toEqual({ canPost, denialReason });
      const write = service.assertCanPost({
        ownerId: 'owner',
        userId: 'participant',
        postingPolicy,
        member,
      });
      if (canPost) await expect(write).resolves.toBeUndefined();
      else await expect(write).rejects.toMatchObject({ errorCode });
    },
  );

  it.each(policies)('任一方向拉黑时 %s 策略均优先返回 BLOCKED_RELATION', async (postingPolicy) => {
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'block' });
    const member = { role: 'COLLABORATOR' as MemberRole, playerMarked: true };
    expect(
      service.evaluate({
        ownerId: 'owner',
        userId: 'manager',
        postingPolicy,
        member,
        blockedRelation: true,
      }),
    ).toEqual({ canPost: false, denialReason: 'BLOCKED_RELATION' });
    await expect(
      service.assertCanPost({ ownerId: 'owner', userId: 'manager', postingPolicy, member }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('详情只查一次双向拉黑并为全部子贴映射，且不污染共享对象', async () => {
    const cached = {
      id: 'thread',
      ownerId: 'owner',
      subthreads: policies.map((postingPolicy, index) => ({ id: `s${index}`, postingPolicy })),
    };
    const projected = await service.attachToThread(cached, 'participant', {
      role: 'PARTICIPANT',
      playerMarked: false,
    });

    expect(prisma.userBlock.findFirst).toHaveBeenCalledTimes(1);
    expect(projected.subthreads.map((item) => item.postingCapability)).toEqual([
      { canPost: true, denialReason: null },
      { canPost: false, denialReason: 'COLLABORATOR_REQUIRED' },
      { canPost: false, denialReason: 'PLAYER_REQUIRED' },
    ]);
    expect(cached.subthreads.every((item) => !('postingCapability' in item))).toBe(true);
  });

  it('楼主不读取无意义的自我拉黑关系', async () => {
    await service.attachToThread(
      { ownerId: 'owner', subthreads: [{ postingPolicy: 'PLAYERS' }] },
      'owner',
      null,
    );
    expect(prisma.userBlock.findFirst).not.toHaveBeenCalled();
  });
});
