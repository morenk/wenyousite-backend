import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  ContentRemovalSource,
  ModerationAppealStatus,
  ModerationCaseStatus,
  ModerationDecisionAction,
  Prisma,
  ReportStatus,
  ReportTargetType,
  UserSanctionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../common/dto/paginated-result';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AuditService } from './audit.service';
import { AdminActor } from './admin-policy.service';
import {
  AdminRequestContext,
  ContentModerationEffect,
  ModerationService,
} from './moderation.service';
import {
  ModerationAppealQueryDto,
  ModerationCaseQueryDto,
  ResolveModerationAppealDto,
  ResolveModerationCaseDto,
} from './dto/moderation-case.dto';

const APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const publicAppealSelect = {
  id: true,
  statement: true,
  status: true,
  createdAt: true,
  decision: {
    select: {
      id: true,
      targetType: true,
      targetId: true,
      action: true,
      policyCode: true,
      publicExplanation: true,
      active: true,
      createdAt: true,
    },
  },
  appellant: { select: { id: true, username: true } },
} satisfies Prisma.ModerationAppealSelect;

function conflict(code: number, message: string) {
  return new BusinessException(code, message, HttpStatus.CONFLICT);
}

const caseInclude = {
  resolvedBy: { select: { id: true, username: true, role: true } },
  reports: {
    include: {
      reporter: { select: { id: true, username: true, role: true } },
      handler: { select: { id: true, username: true, role: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  decisions: {
    include: {
      actor: { select: { id: true, username: true, role: true } },
      appeal: { include: { appellant: { select: { id: true, username: true } } } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.ModerationCaseInclude;

@Injectable()
export class ModerationCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
  ) {}

  async listCases(query: ModerationCaseQueryDto) {
    const take = Math.min(query.limit ?? 20, 50);
    const cases = await this.prisma.moderationCase.findMany({
      where: {
        status: query.status,
        targetType: query.targetType,
        ...(query.reasonCode ? { reports: { some: { reasonCode: query.reasonCode } } } : {}),
      },
      include: {
        _count: { select: { reports: true } },
        reports: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { reasonCode: true, details: true, createdAt: true, targetSnapshot: true },
        },
        decisions: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { action: true, publicExplanation: true, active: true, createdAt: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
    });
    const hasMore = cases.length > take;
    if (hasMore) cases.pop();
    return paginate(cases, { cursor: cases.at(-1)?.id ?? null, hasMore });
  }

  async getCase(id: string) {
    const moderationCase = await this.prisma.moderationCase.findUnique({
      where: { id },
      include: caseInclude,
    });
    if (!moderationCase) throw notFound(ErrorCode.MODERATION_CASE_NOT_FOUND, '治理案件不存在');
    return moderationCase;
  }

  async resolveCase(
    id: string,
    actor: AdminActor,
    dto: ResolveModerationCaseDto,
    context: AdminRequestContext,
  ) {
    let contentEffect: ContentModerationEffect | undefined;
    let sanctionedUserId: string | undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.moderationCase.findUnique({
        where: { id },
        include: { reports: { where: { status: ReportStatus.PENDING }, select: { id: true } } },
      });
      if (!current) throw notFound(ErrorCode.MODERATION_CASE_NOT_FOUND, '治理案件不存在');
      if (current.status !== ModerationCaseStatus.OPEN) {
        throw conflict(ErrorCode.MODERATION_CASE_ALREADY_CLOSED, '案件已经结案');
      }
      this.assertResolution(current.targetType, dto);
      const now = new Date();
      let decisionId: string | undefined;
      if (dto.outcome === 'RESOLVED' && dto.action) {
        const decision = await tx.moderationDecision.create({
          data: {
            caseId: id,
            targetType: current.targetType,
            targetId: current.targetId,
            action: dto.action,
            policyCode: dto.policyCode,
            publicExplanation: dto.publicExplanation.trim(),
            internalNote: dto.internalNote?.trim() || null,
            actorId: actor.id,
          },
        });
        decisionId = decision.id;
        const reportId = current.reports[0]?.id;
        if (dto.action === ModerationDecisionAction.HIDE_CONTENT) {
          contentEffect = await this.moderation.hideContentInTransaction(
            tx,
            actor,
            current.targetType as 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
            current.targetId,
            dto.publicExplanation,
            context,
            reportId,
          );
        } else {
          sanctionedUserId = await this.targetOwnerId(tx, current.targetType, current.targetId);
          await this.moderation.applySanctionInTransaction(
            tx,
            actor,
            sanctionedUserId,
            {
              type:
                dto.action === ModerationDecisionAction.BAN_USER
                  ? UserSanctionType.BAN
                  : UserSanctionType.SUSPENSION,
              reason: dto.publicExplanation,
              endsAt: dto.suspendUntil,
            },
            context,
            reportId,
            decision.id,
          );
        }
        await this.audit.record(
          {
            actorId: actor.id,
            action: AuditAction.CASE_RESOLVED,
            targetType: AuditTargetType.MODERATION_DECISION,
            targetId: decision.id,
            reason: dto.publicExplanation.trim(),
            metadata: { caseId: id, action: dto.action, actorUsername: actor.username },
            ...context,
          },
          tx,
        );
      }
      await tx.report.updateMany({
        where: { caseId: id, status: ReportStatus.PENDING },
        data: {
          status: dto.outcome === 'RESOLVED' ? ReportStatus.RESOLVED : ReportStatus.DISMISSED,
          handledBy: actor.id,
          handledAt: now,
          resolutionNote: dto.publicExplanation.trim(),
        },
      });
      await tx.moderationCase.update({
        where: { id },
        data: {
          status:
            dto.outcome === 'RESOLVED'
              ? ModerationCaseStatus.RESOLVED
              : ModerationCaseStatus.DISMISSED,
          resolvedById: actor.id,
          resolvedAt: now,
        },
      });
      if (dto.outcome === 'DISMISSED') {
        await this.audit.record(
          {
            actorId: actor.id,
            action: AuditAction.CASE_DISMISSED,
            targetType: AuditTargetType.MODERATION_CASE,
            targetId: id,
            reason: dto.publicExplanation.trim(),
            metadata: { policyCode: dto.policyCode, actorUsername: actor.username },
            ...context,
          },
          tx,
        );
      }
      return { decisionId };
    });
    if (contentEffect) await this.moderation.finalizeContentMutation(contentEffect);
    if (sanctionedUserId) this.moderation.finalizeUserMutation(sanctionedUserId);
    return { ...(await this.getCase(id)), decisionId: result.decisionId ?? null };
  }

  async listMyDecisions(userId: string) {
    const [threads, posts, moments, comments, directMessages] = await this.prisma.$transaction([
      this.prisma.thread.findMany({ where: { ownerId: userId }, select: { id: true } }),
      this.prisma.post.findMany({ where: { authorId: userId }, select: { id: true } }),
      this.prisma.moment.findMany({ where: { authorId: userId }, select: { id: true } }),
      this.prisma.momentComment.findMany({ where: { authorId: userId }, select: { id: true } }),
      this.prisma.directMessage.findMany({ where: { senderId: userId }, select: { id: true } }),
    ]);
    return this.prisma.moderationDecision.findMany({
      where: {
        createdAt: { gt: new Date(Date.now() - APPEAL_WINDOW_MS) },
        OR: [
          { targetType: ReportTargetType.USER, targetId: userId },
          { targetType: ReportTargetType.THREAD, targetId: { in: threads.map(({ id }) => id) } },
          { targetType: ReportTargetType.POST, targetId: { in: posts.map(({ id }) => id) } },
          { targetType: ReportTargetType.MOMENT, targetId: { in: moments.map(({ id }) => id) } },
          {
            targetType: ReportTargetType.MOMENT_COMMENT,
            targetId: { in: comments.map(({ id }) => id) },
          },
          {
            targetType: ReportTargetType.DIRECT_MESSAGE,
            targetId: { in: directMessages.map(({ id }) => id) },
          },
        ],
      },
      select: {
        id: true,
        targetType: true,
        targetId: true,
        action: true,
        policyCode: true,
        publicExplanation: true,
        active: true,
        reversedAt: true,
        createdAt: true,
        appeal: {
          select: {
            id: true,
            statement: true,
            status: true,
            handledNote: true,
            createdAt: true,
            handledAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async createAppeal(userId: string, decisionId: string, statement: string) {
    const decision = await this.prisma.moderationDecision.findUnique({
      where: { id: decisionId },
      include: { appeal: true },
    });
    if (!decision) throw notFound(ErrorCode.MODERATION_DECISION_NOT_FOUND, '治理决定不存在');
    if (!decision.active) throw conflict(ErrorCode.APPEAL_WINDOW_CLOSED, '该决定已撤销');
    if (decision.createdAt.getTime() + APPEAL_WINDOW_MS <= Date.now()) {
      throw conflict(ErrorCode.APPEAL_WINDOW_CLOSED, '申诉期限已结束');
    }
    if (decision.appeal) throw conflict(ErrorCode.APPEAL_ALREADY_SUBMITTED, '该决定已经提交过申诉');
    const ownerId = await this.targetOwnerId(this.prisma, decision.targetType, decision.targetId);
    if (ownerId !== userId)
      throw notFound(ErrorCode.MODERATION_DECISION_NOT_FOUND, '治理决定不存在');
    const appeal = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.moderationAppeal.create({
          data: { decisionId, appellantId: userId, statement: statement.trim() },
          select: publicAppealSelect,
        });
        await this.audit.record(
          {
            actorId: userId,
            action: AuditAction.APPEAL_SUBMITTED,
            targetType: AuditTargetType.MODERATION_APPEAL,
            targetId: created.id,
            metadata: { decisionId },
          },
          tx,
        );
        return created;
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === 'P2002') {
          throw conflict(ErrorCode.APPEAL_ALREADY_SUBMITTED, '该决定已经提交过申诉');
        }
        throw error;
      });
    return appeal;
  }

  async listAppeals(query: ModerationAppealQueryDto) {
    const take = Math.min(query.limit ?? 20, 50);
    const appeals = await this.prisma.moderationAppeal.findMany({
      where: {
        status: query.status,
        ...(query.targetType || query.action
          ? {
              decision: {
                targetType: query.targetType,
                action: query.action,
              },
            }
          : {}),
      },
      include: {
        appellant: { select: { id: true, username: true, role: true } },
        handledBy: { select: { id: true, username: true, role: true } },
        decision: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
    });
    const hasMore = appeals.length > take;
    if (hasMore) appeals.pop();
    return paginate(appeals, { cursor: appeals.at(-1)?.id ?? null, hasMore });
  }

  async resolveAppeal(
    id: string,
    actor: AdminActor,
    dto: ResolveModerationAppealDto,
    context: AdminRequestContext,
  ) {
    let contentEffect: ContentModerationEffect | undefined;
    let sanctionedUserId: string | undefined;
    await this.prisma.$transaction(async (tx) => {
      const appeal = await tx.moderationAppeal.findUnique({
        where: { id },
        include: { decision: { include: { sanction: true } } },
      });
      if (!appeal) throw notFound(ErrorCode.MODERATION_APPEAL_NOT_FOUND, '申诉不存在');
      if (appeal.status !== ModerationAppealStatus.PENDING) {
        throw conflict(ErrorCode.CONFLICT, '申诉已经处理');
      }
      const now = new Date();
      if (dto.outcome === 'OVERTURNED') {
        if (!appeal.decision.active) throw conflict(ErrorCode.CONFLICT, '治理决定已经撤销');
        if (appeal.decision.action === ModerationDecisionAction.HIDE_CONTENT) {
          contentEffect = await this.restoreDecisionContent(
            tx,
            appeal.decision.targetType,
            appeal.decision.targetId,
          );
        } else if (appeal.decision.sanction && !appeal.decision.sanction.revokedAt) {
          sanctionedUserId = appeal.decision.sanction.userId;
          await tx.userSanction.update({
            where: { id: appeal.decision.sanction.id },
            data: { revokedAt: now, revokedById: actor.id, revokeReason: dto.note.trim() },
          });
        }
        await tx.moderationDecision.update({
          where: { id: appeal.decisionId },
          data: { active: false, reversedAt: now, reversedById: actor.id },
        });
      }
      await tx.moderationAppeal.update({
        where: { id },
        data: {
          status:
            dto.outcome === 'OVERTURNED'
              ? ModerationAppealStatus.OVERTURNED
              : ModerationAppealStatus.UPHELD,
          handledById: actor.id,
          handledNote: dto.note.trim(),
          handledAt: now,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action:
            dto.outcome === 'OVERTURNED'
              ? AuditAction.APPEAL_OVERTURNED
              : AuditAction.APPEAL_UPHELD,
          targetType: AuditTargetType.MODERATION_APPEAL,
          targetId: id,
          reason: dto.note.trim(),
          metadata: { decisionId: appeal.decisionId, actorUsername: actor.username },
          ...context,
        },
        tx,
      );
    });
    if (contentEffect) await this.moderation.finalizeContentMutation(contentEffect);
    if (sanctionedUserId) this.moderation.finalizeUserMutation(sanctionedUserId);
    return this.prisma.moderationAppeal.findUniqueOrThrow({
      where: { id },
      include: { decision: true, appellant: { select: { id: true, username: true } } },
    });
  }

  private assertResolution(targetType: ReportTargetType, dto: ResolveModerationCaseDto) {
    if (dto.outcome === 'DISMISSED' && dto.action) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '驳回案件时不能执行处置');
    }
    if (dto.outcome === 'RESOLVED' && !dto.action) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '确认违规时必须选择处置动作');
    }
    if (
      dto.action === ModerationDecisionAction.HIDE_CONTENT &&
      !(
        [
          ReportTargetType.THREAD,
          ReportTargetType.POST,
          ReportTargetType.MOMENT,
          ReportTargetType.MOMENT_COMMENT,
        ] as ReportTargetType[]
      ).includes(targetType)
    ) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该目标不能执行内容隐藏');
    }
    if (dto.action === ModerationDecisionAction.SUSPEND_USER && !dto.suspendUntil) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '暂停账号必须提供结束时间');
    }
    if (dto.action !== ModerationDecisionAction.SUSPEND_USER && dto.suspendUntil) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '仅暂停账号时可以设置结束时间');
    }
  }

  private async targetOwnerId(
    client: PrismaService | Prisma.TransactionClient,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<string> {
    if (targetType === ReportTargetType.USER) return targetId;
    if (targetType === ReportTargetType.THREAD) {
      const target = await client.thread.findUnique({
        where: { id: targetId },
        select: { ownerId: true },
      });
      if (!target) throw notFound(ErrorCode.NOT_FOUND, '治理目标不存在');
      return target.ownerId;
    }
    if (targetType === ReportTargetType.POST) {
      const target = await client.post.findUnique({
        where: { id: targetId },
        select: { authorId: true },
      });
      if (!target) throw notFound(ErrorCode.NOT_FOUND, '治理目标不存在');
      return target.authorId;
    }
    if (targetType === ReportTargetType.MOMENT) {
      const target = await client.moment.findUnique({
        where: { id: targetId },
        select: { authorId: true },
      });
      if (!target) throw notFound(ErrorCode.NOT_FOUND, '治理目标不存在');
      return target.authorId;
    }
    if (targetType === ReportTargetType.MOMENT_COMMENT) {
      const target = await client.momentComment.findUnique({
        where: { id: targetId },
        select: { authorId: true },
      });
      if (!target) throw notFound(ErrorCode.NOT_FOUND, '治理目标不存在');
      return target.authorId;
    }
    const target = await client.directMessage.findUnique({
      where: { id: targetId },
      select: { senderId: true },
    });
    if (!target) throw notFound(ErrorCode.NOT_FOUND, '治理目标不存在');
    return target.senderId;
  }

  private async restoreDecisionContent(
    tx: Prisma.TransactionClient,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<ContentModerationEffect> {
    if (targetType === ReportTargetType.THREAD) {
      const target = await tx.thread.findUnique({
        where: { id: targetId },
        select: { deletedAt: true, removalSource: true },
      });
      if (!target || !target.deletedAt || target.removalSource !== ContentRemovalSource.ADMIN) {
        throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '内容已不处于可恢复状态');
      }
      await tx.thread.update({
        where: { id: targetId },
        data: { deletedAt: null, removalSource: null, removedById: null, removalReason: null },
      });
      return { targetType: 'THREAD', targetId, hidden: false, deletedAt: null, threadId: targetId };
    }
    if (targetType === ReportTargetType.POST) {
      const target = await tx.post.findUnique({
        where: { id: targetId },
        select: { deletedAt: true, removalSource: true, threadId: true, parentPostId: true },
      });
      if (!target || !target.deletedAt || target.removalSource !== ContentRemovalSource.ADMIN) {
        throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '内容已不处于可恢复状态');
      }
      await tx.post.update({
        where: { id: targetId },
        data: { deletedAt: null, removalSource: null, removedById: null, removalReason: null },
      });
      return {
        targetType: 'POST',
        targetId,
        hidden: false,
        deletedAt: null,
        threadId: target.threadId,
        parentPostId: target.parentPostId,
      };
    }
    if (targetType === ReportTargetType.MOMENT) {
      await tx.$queryRaw`SELECT "id" FROM "moments" WHERE "id" = ${targetId} FOR UPDATE`;
      const target = await tx.moment.findUnique({
        where: { id: targetId },
        select: { deletedAt: true, removalSource: true },
      });
      if (!target || !target.deletedAt || target.removalSource !== ContentRemovalSource.ADMIN) {
        throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '内容已不处于可恢复状态');
      }
      await tx.moment.update({
        where: { id: targetId },
        data: { deletedAt: null, removalSource: null, removedById: null, removalReason: null },
      });
      return { targetType: 'MOMENT', targetId, hidden: false, deletedAt: null, momentId: targetId };
    }
    if (targetType === ReportTargetType.MOMENT_COMMENT) {
      const preliminary = await tx.momentComment.findUnique({
        where: { id: targetId },
        select: { momentId: true },
      });
      if (!preliminary) {
        throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '内容已不处于可恢复状态');
      }
      await tx.$queryRaw`
        SELECT "id" FROM "moments" WHERE "id" = ${preliminary.momentId} FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "moment_comments" WHERE "id" = ${targetId} FOR UPDATE
      `;
      const target = await tx.momentComment.findUnique({
        where: { id: targetId },
        select: {
          deletedAt: true,
          removalSource: true,
          momentId: true,
          moment: { select: { deletedAt: true } },
        },
      });
      if (!target || !target.deletedAt || target.removalSource !== ContentRemovalSource.ADMIN) {
        throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '内容已不处于可恢复状态');
      }
      if (target.moment.deletedAt) {
        throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '所属动态仍不可见，不能恢复评论');
      }
      await tx.momentComment.update({
        where: { id: targetId },
        data: { deletedAt: null, removalSource: null, removedById: null, removalReason: null },
      });
      const updated = await tx.moment.updateMany({
        where: { id: target.momentId, deletedAt: null },
        data: { commentCount: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '所属动态仍不可见，不能恢复评论');
      }
      return {
        targetType: 'MOMENT_COMMENT',
        targetId,
        hidden: false,
        deletedAt: null,
        momentId: target.momentId,
      };
    }
    throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '该目标不是可恢复内容');
  }
}
