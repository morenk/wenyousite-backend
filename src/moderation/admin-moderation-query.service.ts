import { HttpStatus, Injectable } from '@nestjs/common';
import { ContentRemovalSource, Prisma, UserSanctionType } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';
import { paginate } from '../common/dto/paginated-result';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { activeSanctionWhere } from '../access/account-status';
import {
  AdminHiddenContentQueryDto,
  AdminUserQueryDto,
  AuditLogQueryDto,
} from './dto/moderation.dto';

type HiddenContentType = 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT';

interface HiddenContentCursor {
  hiddenAt: string;
  targetType: HiddenContentType;
  targetId: string;
}

interface HiddenContentCandidate {
  targetType: HiddenContentType;
  targetId: string;
  summary: string;
  author: { id: string; username: string };
  removedById: string | null;
  hiddenAt: Date;
  reason: string | null;
  canRestore: boolean;
  restoreBlockedReason: string | null;
  threadId: string | null;
  parentPostId: string | null;
  momentId: string | null;
  parentCommentId: string | null;
}

const HIDDEN_CONTENT_ORDER: Record<HiddenContentType, number> = {
  THREAD: 0,
  POST: 1,
  MOMENT: 2,
  MOMENT_COMMENT: 3,
};

function encodeHiddenContentCursor(item: HiddenContentCandidate) {
  return Buffer.from(
    JSON.stringify({
      hiddenAt: item.hiddenAt.toISOString(),
      targetType: item.targetType,
      targetId: item.targetId,
    } satisfies HiddenContentCursor),
  ).toString('base64url');
}

function decodeHiddenContentCursor(cursor: string): HiddenContentCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<HiddenContentCursor>;
    if (
      !value.hiddenAt ||
      Number.isNaN(Date.parse(value.hiddenAt)) ||
      !value.targetType ||
      !(value.targetType in HIDDEN_CONTENT_ORDER) ||
      !value.targetId
    ) {
      throw new Error('invalid cursor shape');
    }
    return value as HiddenContentCursor;
  } catch {
    throw new BusinessException(
      ErrorCode.INVALID_CURSOR,
      '无效的隐藏内容游标',
      HttpStatus.BAD_REQUEST,
    );
  }
}

function hiddenContentCursorWhere(targetType: HiddenContentType, cursor?: HiddenContentCursor) {
  if (!cursor) return {};
  const hiddenAt = new Date(cursor.hiddenAt);
  const typeOrder = HIDDEN_CONTENT_ORDER[targetType];
  const cursorTypeOrder = HIDDEN_CONTENT_ORDER[cursor.targetType];
  if (typeOrder > cursorTypeOrder) return { deletedAt: { lte: hiddenAt } };
  if (typeOrder < cursorTypeOrder) return { deletedAt: { lt: hiddenAt } };
  return {
    OR: [{ deletedAt: { lt: hiddenAt } }, { deletedAt: hiddenAt, id: { lt: cursor.targetId } }],
  };
}

function summarizeContent(value: string | null | undefined, fallback: string) {
  const summary = value?.replace(/\s+/g, ' ').trim();
  if (!summary) return fallback;
  const characters = Array.from(summary);
  return characters.length > 160 ? `${characters.slice(0, 160).join('')}…` : summary;
}

const activeSanctionSelect = {
  id: true,
  type: true,
  reason: true,
  startsAt: true,
  endsAt: true,
  revokedAt: true,
  reportId: true,
} as const;

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
        some: { ...activeWhere, type: UserSanctionType.SUSPENSION },
      };
    }
    if (query.status === 'BANNED') {
      where.sanctions = { some: { ...activeWhere, type: UserSanctionType.BAN } };
    }

    const take = Math.min(query.limit ?? 20, 50);
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
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

  async listHiddenContent(query: AdminHiddenContentQueryDto) {
    const take = Math.min(query.limit ?? 20, 50);
    const cursor = query.cursor ? decodeHiddenContentCursor(query.cursor) : undefined;
    const includes = (targetType: HiddenContentType) =>
      !query.targetType || query.targetType === targetType;
    const baseWhere = { removalSource: ContentRemovalSource.ADMIN, deletedAt: { not: null } };

    const [threads, posts, moments, comments] = await Promise.all([
      includes('THREAD')
        ? this.prisma.thread.findMany({
            where: {
              ...baseWhere,
              ...hiddenContentCursorWhere('THREAD', cursor),
            },
            select: {
              id: true,
              title: true,
              published: true,
              visibility: true,
              deletedAt: true,
              removalReason: true,
              removedById: true,
              owner: { select: { id: true, username: true } },
            },
            orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
            take: take + 1,
          })
        : Promise.resolve([]),
      includes('POST')
        ? this.prisma.post.findMany({
            where: {
              ...baseWhere,
              ...hiddenContentCursorWhere('POST', cursor),
            },
            select: {
              id: true,
              content: true,
              parentPostId: true,
              deletedAt: true,
              removalReason: true,
              removedById: true,
              author: { select: { id: true, username: true } },
              thread: {
                select: {
                  id: true,
                  title: true,
                  published: true,
                  visibility: true,
                  deletedAt: true,
                },
              },
              subthread: { select: { deletedAt: true } },
            },
            orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
            take: take + 1,
          })
        : Promise.resolve([]),
      includes('MOMENT')
        ? this.prisma.moment.findMany({
            where: {
              ...baseWhere,
              ...hiddenContentCursorWhere('MOMENT', cursor),
            },
            select: {
              id: true,
              title: true,
              content: true,
              deletedAt: true,
              removalReason: true,
              removedById: true,
              author: { select: { id: true, username: true } },
            },
            orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
            take: take + 1,
          })
        : Promise.resolve([]),
      includes('MOMENT_COMMENT')
        ? this.prisma.momentComment.findMany({
            where: {
              ...baseWhere,
              ...hiddenContentCursorWhere('MOMENT_COMMENT', cursor),
            },
            select: {
              id: true,
              content: true,
              parentCommentId: true,
              deletedAt: true,
              removalReason: true,
              removedById: true,
              author: { select: { id: true, username: true } },
              moment: { select: { id: true, deletedAt: true } },
            },
            orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
            take: take + 1,
          })
        : Promise.resolve([]),
    ]);

    const candidates: HiddenContentCandidate[] = [
      ...threads.map((thread) => {
        const canRestore = thread.published && thread.visibility === 'PUBLIC';
        return {
          targetType: 'THREAD' as const,
          targetId: thread.id,
          summary: summarizeContent(thread.title, '未命名主题帖'),
          author: thread.owner,
          removedById: thread.removedById,
          hiddenAt: thread.deletedAt!,
          reason: thread.removalReason,
          canRestore,
          restoreBlockedReason: canRestore ? null : '主题帖已不是公开发布状态，暂时不能恢复',
          threadId: thread.id,
          parentPostId: null,
          momentId: null,
          parentCommentId: null,
        };
      }),
      ...posts.map((post) => {
        const canRestore =
          post.thread.published &&
          post.thread.visibility === 'PUBLIC' &&
          !post.thread.deletedAt &&
          !post.subthread.deletedAt;
        return {
          targetType: 'POST' as const,
          targetId: post.id,
          summary: summarizeContent(post.content, post.thread.title ?? '帖子内容'),
          author: post.author,
          removedById: post.removedById,
          hiddenAt: post.deletedAt!,
          reason: post.removalReason,
          canRestore,
          restoreBlockedReason: canRestore ? null : '父级主题帖或子贴仍不可见，请先恢复父级内容',
          threadId: post.thread.id,
          parentPostId: post.parentPostId,
          momentId: null,
          parentCommentId: null,
        };
      }),
      ...moments.map((moment) => ({
        targetType: 'MOMENT' as const,
        targetId: moment.id,
        summary: summarizeContent(moment.title || moment.content, '动态内容'),
        author: moment.author,
        removedById: moment.removedById,
        hiddenAt: moment.deletedAt!,
        reason: moment.removalReason,
        canRestore: true,
        restoreBlockedReason: null,
        threadId: null,
        parentPostId: null,
        momentId: moment.id,
        parentCommentId: null,
      })),
      ...comments.map((comment) => {
        const canRestore = !comment.moment.deletedAt;
        return {
          targetType: 'MOMENT_COMMENT' as const,
          targetId: comment.id,
          summary: summarizeContent(comment.content, '动态评论'),
          author: comment.author,
          removedById: comment.removedById,
          hiddenAt: comment.deletedAt!,
          reason: comment.removalReason,
          canRestore,
          restoreBlockedReason: canRestore ? null : '所属动态仍不可见，请先恢复动态',
          threadId: null,
          parentPostId: null,
          momentId: comment.moment.id,
          parentCommentId: comment.parentCommentId,
        };
      }),
    ].sort(
      (left, right) =>
        right.hiddenAt.getTime() - left.hiddenAt.getTime() ||
        HIDDEN_CONTENT_ORDER[left.targetType] - HIDDEN_CONTENT_ORDER[right.targetType] ||
        right.targetId.localeCompare(left.targetId),
    );

    const hasMore = candidates.length > take;
    const page = candidates.slice(0, take);
    const moderatorIds = [...new Set(page.flatMap((item) => item.removedById ?? []))];
    const moderators = moderatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: moderatorIds } },
          select: { id: true, username: true },
        })
      : [];
    const moderatorById = new Map(moderators.map((moderator) => [moderator.id, moderator]));
    const items = page.map(({ removedById, ...item }) => ({
      ...item,
      moderator: removedById ? (moderatorById.get(removedById) ?? null) : null,
    }));

    return paginate(items, {
      cursor: page.length ? encodeHiddenContentCursor(page.at(-1)!) : null,
      hasMore,
    });
  }

  async listAuditLogs(query: AuditLogQueryDto) {
    const where = this.auditWhere(query);
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

  async exportAuditLogs(query: AuditLogQueryDto) {
    const logs = await this.prisma.auditLog.findMany({
      where: this.auditWhere(query),
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
      take: 10_000,
    });
    return stringify(
      logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        action: log.action,
        actorId: log.actor?.id ?? '',
        actorUsername: log.actor?.username ?? 'system',
        actorRole: log.actor?.role ?? '',
        targetType: log.targetType,
        targetId: log.targetId ?? '',
        reportId: log.reportId ?? '',
        reason: log.reason ?? '',
        metadata: log.metadata ? JSON.stringify(log.metadata) : '',
      })),
      {
        bom: true,
        header: true,
        escape_formulas: true,
        columns: [
          'id',
          'createdAt',
          'action',
          'actorId',
          'actorUsername',
          'actorRole',
          'targetType',
          'targetId',
          'reportId',
          'reason',
          'metadata',
        ],
      },
    );
  }

  private auditWhere(query: AuditLogQueryDto): Prisma.AuditLogWhereInput {
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
    return where;
  }
}
