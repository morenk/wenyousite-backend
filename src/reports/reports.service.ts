import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  Prisma,
  ReportReasonCode,
  ReportStatus,
  ReportTargetType,
  ThreadVisibility,
  UserSanctionType,
} from '@prisma/client';
import { AdminActor } from '../moderation/admin-policy.service';
import { AuditService } from '../moderation/audit.service';
import {
  AdminRequestContext,
  ContentModerationEffect,
  ModerationService,
} from '../moderation/moderation.service';
import { paginate } from '../common/dto/paginated-result';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { activeSanctionWhere } from '../access/account-status';

const adminUserSelect = { id: true, username: true, role: true } as const;

const adminReportInclude = {
  reporter: { select: adminUserSelect },
  handler: { select: adminUserSelect },
} satisfies Prisma.ReportInclude;

function reportConflict(code: number, message: string) {
  return new BusinessException(code, message, HttpStatus.CONFLICT);
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
  ) {}

  async create(reporterId: string, dto: CreateReportDto) {
    if (dto.reasonCode === ReportReasonCode.OTHER && !dto.details?.trim()) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '选择其他原因时必须填写补充说明');
    }
    const targetSnapshot = await this.buildTargetSnapshot(reporterId, dto.targetType, dto.targetId);
    try {
      return await this.createInOpenCase(reporterId, dto, targetSnapshot);
    } catch (error: unknown) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const duplicate = await this.prisma.report.findFirst({
        where: {
          reporterId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          status: ReportStatus.PENDING,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw reportConflict(ErrorCode.REPORT_ALREADY_PENDING, '已提交过相同的待处理举报');
      }
      // 两名用户同时首次举报同一目标时，开放案件的部分唯一索引只允许一个创建者。
      // 等获胜事务提交后重试，第二份举报应聚合进同一案件而不是被误判为重复举报。
      try {
        return await this.createInOpenCase(reporterId, dto, targetSnapshot);
      } catch (retryError: unknown) {
        if ((retryError as { code?: string })?.code === 'P2002') {
          throw reportConflict(ErrorCode.REPORT_ALREADY_PENDING, '已提交过相同的待处理举报');
        }
        throw retryError;
      }
    }
  }

  private createInOpenCase(
    reporterId: string,
    dto: CreateReportDto,
    targetSnapshot: Record<string, unknown>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      let moderationCase = await tx.moderationCase.findFirst({
        where: { targetType: dto.targetType, targetId: dto.targetId, status: 'OPEN' },
        select: { id: true },
      });
      moderationCase ??= await tx.moderationCase.create({
        data: { targetType: dto.targetType, targetId: dto.targetId },
        select: { id: true },
      });
      return tx.report.create({
        data: {
          reporterId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reasonCode: dto.reasonCode,
          details: dto.details?.trim() ?? null,
          targetSnapshot: targetSnapshot as Prisma.InputJsonValue,
          caseId: moderationCase.id,
        },
      });
    });
  }

  async findAll(query: ReportQueryDto) {
    const where: Prisma.ReportWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.targetType) where.targetType = query.targetType;
    if (query.reasonCode) where.reasonCode = query.reasonCode;
    const take = Math.min(query.limit ?? 20, 50);
    const reports = await this.prisma.report.findMany({
      where,
      include: adminReportInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
    });
    const hasMore = reports.length > take;
    if (hasMore) reports.pop();
    return paginate(reports, { cursor: reports.at(-1)?.id ?? null, hasMore });
  }

  async findOne(id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: adminReportInclude,
    });
    if (!report) throw notFound(ErrorCode.REPORT_NOT_FOUND, '举报不存在');
    return {
      ...report,
      targetState: await this.getTargetState(report.targetType, report.targetId),
    };
  }

  async resolve(
    id: string,
    actor: AdminActor,
    dto: ResolveReportDto,
    context: AdminRequestContext,
  ) {
    let contentEffect: ContentModerationEffect | undefined;
    let sanctionedUserId: string | undefined;
    const report = await this.prisma.$transaction(async (tx) => {
      const current = await tx.report.findUnique({ where: { id } });
      if (!current) throw notFound(ErrorCode.REPORT_NOT_FOUND, '举报不存在');
      if (current.status !== ReportStatus.PENDING) {
        throw reportConflict(ErrorCode.REPORT_ALREADY_HANDLED, '举报已经结案');
      }
      const action = dto.action ?? 'NONE';
      this.assertResolutionCompatible(current.targetType, dto.outcome, action, dto.suspendUntil);

      const claimed = await tx.report.updateMany({
        where: { id, status: ReportStatus.PENDING },
        data: {
          status: dto.outcome,
          handledBy: actor.id,
          handledAt: new Date(),
          resolutionNote: dto.note.trim(),
        },
      });
      if (claimed.count !== 1) {
        throw reportConflict(ErrorCode.REPORT_ALREADY_HANDLED, '举报已经结案');
      }

      if (action === 'HIDE_CONTENT') {
        contentEffect = await this.moderation.hideContentInTransaction(
          tx,
          actor,
          current.targetType as 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
          current.targetId,
          dto.note,
          context,
          id,
        );
      }
      if (action === 'SUSPEND_USER' || action === 'BAN_USER') {
        sanctionedUserId = current.targetId;
        await this.moderation.applySanctionInTransaction(
          tx,
          actor,
          current.targetId,
          {
            type: action === 'BAN_USER' ? UserSanctionType.BAN : UserSanctionType.SUSPENSION,
            reason: dto.note,
            endsAt: dto.suspendUntil,
          },
          context,
          id,
        );
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action:
            dto.outcome === ReportStatus.RESOLVED
              ? AuditAction.REPORT_RESOLVED
              : AuditAction.REPORT_DISMISSED,
          targetType: AuditTargetType.REPORT,
          targetId: id,
          reportId: id,
          reason: dto.note.trim(),
          metadata: {
            resolutionAction: action,
            reportedTargetType: current.targetType,
            reportedTargetId: current.targetId,
            actorUsername: actor.username,
          },
          ...context,
        },
        tx,
      );
      return tx.report.findUniqueOrThrow({ where: { id }, include: adminReportInclude });
    });
    if (contentEffect) await this.moderation.finalizeContentMutation(contentEffect);
    if (sanctionedUserId) this.moderation.finalizeUserMutation(sanctionedUserId);
    return {
      ...report,
      targetState: await this.getTargetState(report.targetType, report.targetId),
    };
  }

  private assertResolutionCompatible(
    targetType: ReportTargetType,
    outcome: 'RESOLVED' | 'DISMISSED',
    action: string,
    suspendUntil?: string,
  ) {
    if (outcome === ReportStatus.DISMISSED && action !== 'NONE') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '驳回举报时不能执行处罚');
    }
    if (
      targetType === ReportTargetType.USER &&
      !['NONE', 'SUSPEND_USER', 'BAN_USER'].includes(action)
    ) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '用户举报不能执行内容隐藏');
    }
    if (targetType !== ReportTargetType.USER && !['NONE', 'HIDE_CONTENT'].includes(action)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '内容举报不能执行账号处罚');
    }
    if (action === 'SUSPEND_USER' && !suspendUntil) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '暂停用户时必须提供 suspendUntil');
    }
    if (action !== 'SUSPEND_USER' && suspendUntil) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '仅暂停用户时可以提供 suspendUntil');
    }
  }

  private async buildTargetSnapshot(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<Record<string, unknown>> {
    const capturedAt = new Date().toISOString();
    if (targetType === ReportTargetType.USER) {
      const user = await this.prisma.user.findUnique({
        where: { id: targetId, deletedAt: null },
        select: { id: true, username: true, avatar: true, role: true },
      });
      if (!user) throw notFound(ErrorCode.USER_NOT_FOUND, '被举报用户不存在');
      if (user.id === reporterId)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能举报自己');
      return { snapshotVersion: 1, targetType, capturedAt, user };
    }
    if (targetType === ReportTargetType.THREAD) {
      const thread = await this.prisma.thread.findFirst({
        where: {
          id: targetId,
          published: true,
          visibility: ThreadVisibility.PUBLIC,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          ownerId: true,
          owner: { select: { id: true, username: true } },
        },
      });
      if (!thread) throw notFound(ErrorCode.THREAD_NOT_FOUND, '被举报主题帖不存在');
      if (thread.ownerId === reporterId)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能举报自己的主题帖');
      return { snapshotVersion: 1, targetType, capturedAt, thread };
    }
    if (targetType === ReportTargetType.MOMENT) {
      const moment = await this.prisma.moment.findFirst({
        where: { id: targetId, deletedAt: null },
        select: {
          id: true,
          title: true,
          content: true,
          authorId: true,
          author: { select: { id: true, username: true } },
        },
      });
      if (!moment) throw notFound(ErrorCode.MOMENT_NOT_FOUND, '被举报动态不存在');
      if (moment.authorId === reporterId)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能举报自己的动态');
      return { snapshotVersion: 1, targetType, capturedAt, moment };
    }
    if (targetType === ReportTargetType.MOMENT_COMMENT) {
      const comment = await this.prisma.momentComment.findFirst({
        where: { id: targetId, deletedAt: null, moment: { deletedAt: null } },
        select: {
          id: true,
          content: true,
          authorId: true,
          momentId: true,
          author: { select: { id: true, username: true } },
        },
      });
      if (!comment) throw notFound(ErrorCode.MOMENT_NOT_FOUND, '被举报动态评论不存在');
      if (comment.authorId === reporterId)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '不能举报自己的评论');
      return { snapshotVersion: 1, targetType, capturedAt, comment };
    }
    if (targetType === ReportTargetType.DIRECT_MESSAGE) {
      const directMessage = await this.prisma.directMessage.findFirst({
        where: { id: targetId, recipientId: reporterId },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          recipientId: true,
          content: true,
          recalledAt: true,
          createdAt: true,
          sender: { select: { id: true, username: true } },
          media: { select: { id: true, url: true, contentType: true } },
          sticker: { select: { id: true, url: true } },
        },
      });
      if (!directMessage) {
        throw notFound(ErrorCode.NOT_FOUND, '只能举报自己收到的私聊消息');
      }
      return { snapshotVersion: 1, targetType, capturedAt, directMessage };
    }
    const post = await this.prisma.post.findFirst({
      where: {
        id: targetId,
        deletedAt: null,
        subthread: { deletedAt: null },
        thread: {
          published: true,
          visibility: ThreadVisibility.PUBLIC,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        content: true,
        kind: true,
        authorId: true,
        threadId: true,
        author: { select: { id: true, username: true } },
      },
    });
    if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '被举报帖子不存在');
    if (post.authorId === reporterId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能举报自己的帖子');
    return { snapshotVersion: 1, targetType, capturedAt, post };
  }

  private async getTargetState(targetType: ReportTargetType, targetId: string) {
    if (targetType === ReportTargetType.USER) {
      const user = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          deletedAt: true,
          sanctions: {
            where: activeSanctionWhere(),
            take: 1,
            select: { type: true, endsAt: true },
          },
        },
      });
      return user
        ? {
            exists: true,
            deactivated: Boolean(user.deletedAt),
            currentSanction: user.sanctions[0] ?? null,
          }
        : { exists: false };
    }
    if (targetType === ReportTargetType.DIRECT_MESSAGE) {
      const directMessage = await this.prisma.directMessage.findUnique({
        where: { id: targetId },
        select: { id: true, recalledAt: true },
      });
      return directMessage
        ? { exists: true, recalled: Boolean(directMessage.recalledAt) }
        : { exists: false };
    }
    const record =
      targetType === ReportTargetType.THREAD
        ? await this.prisma.thread.findUnique({
            where: { id: targetId },
            select: { deletedAt: true, removalSource: true },
          })
        : targetType === ReportTargetType.POST
          ? await this.prisma.post.findUnique({
              where: { id: targetId },
              select: { deletedAt: true, removalSource: true },
            })
          : targetType === ReportTargetType.MOMENT
            ? await this.prisma.moment.findUnique({
                where: { id: targetId },
                select: { deletedAt: true, removalSource: true },
              })
            : await this.prisma.momentComment.findUnique({
                where: { id: targetId },
                select: { deletedAt: true, removalSource: true },
              });
    return record
      ? { exists: true, hidden: Boolean(record.deletedAt), removalSource: record.removalSource }
      : { exists: false };
  }
}
