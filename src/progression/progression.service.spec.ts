import { ExperienceEventType } from '@prisma/client';
import { ProgressionService } from './progression.service';

function buildService() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUnique: jest.fn().mockResolvedValue({ experience: 49, level: 1, deletedAt: null }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    experienceEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'xp-1' }),
    },
    experienceDailyStat: {
      upsert: jest.fn().mockResolvedValue({
        checkInCount: 0,
        threadPublishCount: 0,
        postCreateCount: 0,
        receivedReplyCount: 0,
        receivedLikeCount: 0,
        momentPublishCount: 0,
        momentCommentCount: 0,
        momentReplyReceivedCount: 0,
        tipSentCount: 0,
        tipReceivedCount: 0,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new ProgressionService(prisma as never, outbox as never),
    prisma,
    tx,
    outbox,
  };
}

describe('ProgressionService', () => {
  it('经验跨级时原子更新等级并写入升级 Outbox', async () => {
    const { service, tx, outbox } = buildService();

    const result = await service.grant({
      userId: 'user-1',
      type: ExperienceEventType.POST_CREATED,
      idempotencyKey: 'experience:post-created:post-1',
    });

    expect(result).toMatchObject({ granted: true, delta: 3, previousLevel: 1 });
    expect(result.progression).toMatchObject({ level: 2, experience: 52 });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { experience: 52, level: 2 },
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: 'user.level_up', aggregateId: 'user-1' }),
    );
  });

  it('达到当日次数上限后不新增事件或经验', async () => {
    const { service, tx, outbox } = buildService();
    tx.experienceDailyStat.upsert.mockResolvedValue({
      checkInCount: 0,
      threadPublishCount: 0,
      postCreateCount: 5,
      receivedReplyCount: 0,
      receivedLikeCount: 0,
      momentPublishCount: 0,
      momentCommentCount: 0,
      momentReplyReceivedCount: 0,
      tipSentCount: 0,
      tipReceivedCount: 0,
    });

    const result = await service.grant({
      userId: 'user-1',
      type: ExperienceEventType.POST_CREATED,
      idempotencyKey: 'experience:post-created:post-6',
    });

    expect(result.granted).toBe(false);
    expect(tx.experienceEvent.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('同一来源事件重投时保持幂等', async () => {
    const { service, tx } = buildService();
    tx.experienceEvent.findUnique.mockResolvedValue({ delta: 3 });

    const result = await service.grant({
      userId: 'user-1',
      type: ExperienceEventType.POST_CREATED,
      idempotencyKey: 'experience:post-created:post-1',
    });

    expect(result.granted).toBe(false);
    expect(tx.experienceDailyStat.upsert).not.toHaveBeenCalled();
  });

  it('同一业务事件的多笔经验共用一个事务', async () => {
    const { service, prisma } = buildService();

    const result = await service.grantMany([
      {
        userId: 'user-z',
        type: ExperienceEventType.POST_CREATED,
        idempotencyKey: 'experience:post-created:post-z',
      },
      {
        userId: 'user-a',
        type: ExperienceEventType.MOMENT_PUBLISHED,
        idempotencyKey: 'experience:moment-published:moment-a',
      },
    ]);

    expect(result).toHaveLength(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
