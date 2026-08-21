import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContentRemovalSource, UserRole, UserSanctionType } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AdminPolicyService } from './admin-policy.service';
import { AuditService } from './audit.service';
import { ModerationService } from './moderation.service';
import { AdminModerationQueryService } from './admin-moderation-query.service';
import { ModerationProjectionService } from './moderation-projection.service';

describe('ModerationService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    userSanction: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: { updateMany: jest.fn() },
    thread: { findUnique: jest.fn(), update: jest.fn() },
    post: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
    auditLog: { findMany: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const events = { emit: jest.fn() };
  const redis = {
    zrem: jest.fn(),
    zadd: jest.fn(),
    hdelAll: jest.fn(),
    hset: jest.fn(),
  };
  const policy = new AdminPolicyService();
  const queries = { getUser: jest.fn() };
  const admin = { id: 'admin-1', username: 'admin', role: UserRole.ADMIN } as const;
  let service: ModerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    audit.record.mockResolvedValue({});
    for (const method of Object.values(redis)) method.mockResolvedValue(1);
    service = new ModerationService(
      prisma as unknown as PrismaService,
      policy,
      audit as unknown as AuditService,
      new ModerationProjectionService(
        prisma as unknown as PrismaService,
        events as unknown as EventEmitter2,
        redis as unknown as RedisService,
      ),
      queries as unknown as AdminModerationQueryService,
    );
  });

  it('暂停用户、撤销全部会话并写入同事务审计', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: UserRole.USER,
      deletedAt: null,
    });
    prisma.userSanction.findFirst.mockResolvedValue(null);
    const endsAt = new Date(Date.now() + 86_400_000).toISOString();
    prisma.userSanction.create.mockResolvedValue({
      id: 'sanction-1',
      userId: 'user-1',
      type: UserSanctionType.SUSPENSION,
      reason: '骚扰',
      startsAt: new Date(),
      endsAt: new Date(endsAt),
    });

    await service.sanctionUser(
      admin,
      'user-1',
      {
        type: UserSanctionType.SUSPENSION,
        reason: '骚扰',
        endsAt,
      },
      { requestId: 'request-1' },
    );

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_SUSPENDED',
        targetId: 'user-1',
        requestId: 'request-1',
      }),
      prisma,
    );
    expect(events.emit).toHaveBeenCalledWith('user.updated', { userId: 'user-1' });
  });

  it('把有效暂停升级为永久封禁时先解除旧处罚', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: UserRole.USER,
      deletedAt: null,
    });
    prisma.userSanction.findFirst.mockResolvedValue({
      id: 'sanction-old',
      type: UserSanctionType.SUSPENSION,
      endsAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
    });
    prisma.userSanction.update.mockResolvedValue({});
    prisma.userSanction.create.mockResolvedValue({
      id: 'sanction-new',
      type: UserSanctionType.BAN,
      endsAt: null,
    });

    await service.sanctionUser(
      admin,
      'user-1',
      {
        type: UserSanctionType.BAN,
        reason: '多次违规',
      },
      {},
    );

    expect(prisma.userSanction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sanction-old' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_SANCTION_REVOKED',
      }),
      prisma,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_BANNED',
      }),
      prisma,
    );
  });

  it('拒绝无结束时间的暂停和管理员越级处罚', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: UserRole.USER,
      deletedAt: null,
    });
    await expect(
      service.sanctionUser(
        admin,
        'user-1',
        {
          type: UserSanctionType.SUSPENSION,
          reason: '违规',
        },
        {},
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });

    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-2',
      role: UserRole.ADMIN,
      deletedAt: null,
    });
    await expect(
      service.sanctionUser(
        admin,
        'admin-2',
        {
          type: UserSanctionType.BAN,
          reason: '越权测试',
        },
        {},
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CANNOT_MODERATE_ADMIN });
  });

  it('解除生效中的处罚并保留历史记录', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: UserRole.USER,
      deletedAt: null,
    });
    prisma.userSanction.findFirst.mockResolvedValue({
      id: 'sanction-1',
      type: UserSanctionType.BAN,
      endsAt: null,
      revokedAt: null,
    });
    prisma.userSanction.update.mockResolvedValue({ id: 'sanction-1', revokedAt: new Date() });

    await service.revokeSanction(admin, 'user-1', '复核解除', {});

    expect(prisma.userSanction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokeReason: '复核解除', revokedById: 'admin-1' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_SANCTION_REVOKED',
      }),
      prisma,
    );
  });

  it('隐藏公开主题帖后清理排序投影并发出删除事件', async () => {
    prisma.thread.findUnique.mockResolvedValue({
      id: 'thread-1',
      published: true,
      visibility: 'PUBLIC',
      deletedAt: null,
      removalSource: null,
    });
    prisma.thread.update.mockResolvedValue({});

    await service.hideContent(admin, 'THREAD', 'thread-1', '违规主题', {});

    expect(prisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          removalSource: ContentRemovalSource.ADMIN,
          removedById: 'admin-1',
        }),
      }),
    );
    expect(redis.zrem).toHaveBeenCalledTimes(3);
    expect(events.emit).toHaveBeenCalledWith('thread.deleted', { threadId: 'thread-1' });
  });

  it('不能恢复用户主动删除的内容', async () => {
    prisma.thread.findUnique.mockResolvedValue({
      id: 'thread-1',
      published: true,
      visibility: 'PUBLIC',
      deletedAt: new Date(),
      removalSource: ContentRemovalSource.OWNER,
    });
    await expect(
      service.restoreContent(admin, 'THREAD', 'thread-1', '尝试恢复', {}),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CONTENT_STATE_CONFLICT });
  });

  it('新增管理员必须使用邀请流程', async () => {
    const root = { id: 'root-1', username: 'root', role: UserRole.SUPER_ADMIN } as const;
    await expect(
      service.updateRole(root, 'user-1', UserRole.ADMIN, '加入协管', {}),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
