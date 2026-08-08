import { AuditAction, AuditTargetType, UserRole, UserSanctionType } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { AdminModerationQueryService } from './admin-moderation-query.service';

describe('AdminModerationQueryService', () => {
  const prisma = {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    auditLog: { findMany: jest.fn() },
  };
  let service: AdminModerationQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminModerationQueryService(prisma as unknown as PrismaService);
  });

  it('用户列表支持角色、处罚状态和关键词筛选并返回游标', async () => {
    const endsAt = new Date(Date.now() + 60_000);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-2',
        email: 'second@example.com',
        username: 'second',
        role: UserRole.USER,
        emailVerified: true,
        createdAt: new Date(),
        sanctions: [
          {
            id: 'sanction-1',
            type: UserSanctionType.SUSPENSION,
            reason: 'test',
            startsAt: new Date(),
            endsAt,
            revokedAt: null,
            reportId: null,
          },
        ],
      },
      {
        id: 'user-1',
        email: 'first@example.com',
        username: 'first',
        role: UserRole.USER,
        emailVerified: true,
        createdAt: new Date(),
        sanctions: [],
      },
    ]);

    const result = await service.listUsers({
      q: 'example',
      role: UserRole.USER,
      status: 'SUSPENDED',
      limit: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'user-2',
      moderationStatus: 'SUSPENDED',
      currentSanction: { id: 'sanction-1' },
    });
    expect(result.pagination).toEqual({ cursor: 'user-2', hasMore: true });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: UserRole.USER,
          sanctions: { some: expect.objectContaining({ type: UserSanctionType.SUSPENSION }) },
        }),
      }),
    );
  });

  it('用户详情返回派生的永久封禁状态', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      username: 'user',
      role: UserRole.USER,
      emailVerified: true,
      createdAt: new Date(),
      sanctions: [
        {
          id: 'sanction-1',
          type: UserSanctionType.BAN,
          reason: 'test',
          startsAt: new Date(),
          endsAt: null,
          revokedAt: null,
          reportId: null,
        },
      ],
    });

    await expect(service.getUser('user-1')).resolves.toMatchObject({
      moderationStatus: 'BANNED',
    });
  });

  it('用户不存在时返回稳定错误码', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getUser('missing')).rejects.toMatchObject({
      errorCode: ErrorCode.USER_NOT_FOUND,
    });
  });

  it('审计列表支持组合过滤和游标分页', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'audit-2', action: AuditAction.CONTENT_HIDDEN },
      { id: 'audit-1', action: AuditAction.CONTENT_HIDDEN },
    ]);
    const result = await service.listAuditLogs({
      action: AuditAction.CONTENT_HIDDEN,
      targetType: AuditTargetType.POST,
      targetId: 'post-1',
      actorId: 'admin-1',
      createdAfter: '2026-01-01T00:00:00.000Z',
      createdBefore: '2027-01-01T00:00:00.000Z',
      limit: 1,
    });

    expect(result.pagination).toEqual({ cursor: 'audit-2', hasMore: true });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: AuditAction.CONTENT_HIDDEN,
          targetType: AuditTargetType.POST,
          targetId: 'post-1',
          actorId: 'admin-1',
        }),
      }),
    );
  });
});
