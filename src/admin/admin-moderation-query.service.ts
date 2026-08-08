import { Injectable } from '@nestjs/common';
import { Prisma, UserSanctionType } from '@prisma/client';
import { paginate } from '../common/dto/paginated-result';
import { notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUserQueryDto, AuditLogQueryDto } from './dto/moderation.dto';

const activeSanctionSelect = {
  id: true,
  type: true,
  reason: true,
  startsAt: true,
  endsAt: true,
  revokedAt: true,
  reportId: true,
} as const;

function activeSanctionWhere(now = new Date()): Prisma.UserSanctionWhereInput {
  return {
    revokedAt: null,
    OR: [
      { type: UserSanctionType.BAN },
      { type: UserSanctionType.SUSPENSION, endsAt: { gt: now } },
    ],
  };
}

function moderationStatus(sanction?: { type: UserSanctionType }) {
  if (!sanction) return 'ACTIVE' as const;
  return sanction.type === UserSanctionType.BAN ? ('BANNED' as const) : ('SUSPENDED' as const);
}

/** 管理员用户与审计只读查询，和高风险命令事务分离。 */
@Injectable()
export class AdminModerationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: AdminUserQueryDto) {
    const now = new Date();
    const activeWhere = activeSanctionWhere(now);
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { username: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (query.role) where.role = query.role;
    if (query.status === 'ACTIVE') where.sanctions = { none: activeWhere };
    if (query.status === 'SUSPENDED') {
      where.sanctions = {
        some: { revokedAt: null, type: UserSanctionType.SUSPENSION, endsAt: { gt: now } },
      };
    }
    if (query.status === 'BANNED') {
      where.sanctions = { some: { revokedAt: null, type: UserSanctionType.BAN } };
    }

    const take = Math.min(query.limit ?? 20, 50);
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        sanctions: {
          where: activeWhere,
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: activeSanctionSelect,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
    });
    const hasMore = users.length > take;
    if (hasMore) users.pop();
    const items = users.map(({ sanctions, ...user }) => ({
      ...user,
      moderationStatus: moderationStatus(sanctions[0]),
      currentSanction: sanctions[0] ?? null,
    }));
    return paginate(items, { cursor: items.at(-1)?.id ?? null, hasMore });
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        sanctions: {
          where: activeSanctionWhere(),
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: activeSanctionSelect,
        },
      },
    });
    if (!user) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    const { sanctions, ...fields } = user;
    return {
      ...fields,
      moderationStatus: moderationStatus(sanctions[0]),
      currentSanction: sanctions[0] ?? null,
    };
  }

  async listAuditLogs(query: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.actorId) where.actorId = query.actorId;
    if (query.createdAfter || query.createdBefore) {
      where.createdAt = {
        ...(query.createdAfter ? { gte: new Date(query.createdAfter) } : {}),
        ...(query.createdBefore ? { lte: new Date(query.createdBefore) } : {}),
      };
    }
    const take = Math.min(query.limit ?? 20, 50);
    const logs = await this.prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        reportId: true,
        reason: true,
        metadata: true,
        createdAt: true,
        actor: { select: { id: true, username: true, role: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
    });
    const hasMore = logs.length > take;
    if (hasMore) logs.pop();
    return paginate(logs, { cursor: logs.at(-1)?.id ?? null, hasMore });
  }
}
