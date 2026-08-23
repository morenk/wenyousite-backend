import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  ContentRemovalSource,
  Prisma,
  UserRole,
  UserSanctionType,
} from '@prisma/client';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { AdminActor, AdminPolicyService } from './admin-policy.service';
import { AuditService } from './audit.service';
import { SanctionUserDto } from './dto/moderation.dto';
import { AdminModerationQueryService } from './admin-moderation-query.service';
import {
  ContentModerationEffect,
  ModerationProjectionService,
} from './moderation-projection.service';
import { isUniqueConstraintViolation } from '../common/prisma-errors';

export type { ContentModerationEffect } from './moderation-projection.service';

export interface AdminRequestContext {
  ip?: string;
  requestId?: string;
}

function conflict(code: number, message: string) {
  return new BusinessException(code, message, HttpStatus.CONFLICT);
}

function isEffectiveSanction(
  sanction: { type: UserSanctionType; endsAt: Date | null; revokedAt: Date | null },
  now = new Date(),
) {
  if (sanction.revokedAt) return false;
  return (
    sanction.type === UserSanctionType.BAN || Boolean(sanction.endsAt && sanction.endsAt > now)
  );
}

/** 管理员处罚、角色和内容处置的唯一命令入口。 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AdminPolicyService,
    private readonly audit: AuditService,
    private readonly projections: ModerationProjectionService,
    private readonly queries: AdminModerationQueryService,
  ) {}

  async sanctionUser(
    actor: AdminActor,
    targetId: string,
    dto: SanctionUserDto,
    context: AdminRequestContext,
    reportId?: string,
  ) {
    const result = await this.prisma
      .$transaction((tx) =>
        this.applySanctionInTransaction(tx, actor, targetId, dto, context, reportId),
      )
      .catch((error: unknown) => {
        if (isUniqueConstraintViolation(error)) {
          throw conflict(ErrorCode.SANCTION_STATE_CONFLICT, '账号处罚状态已发生变化，请刷新后重试');
        }
        throw error;
      });
    this.finalizeUserMutation(targetId);
    return result;
  }

  async applySanctionInTransaction(
    tx: Prisma.TransactionClient,
    actor: AdminActor,
    targetId: string,
    dto: SanctionUserDto,
    context: AdminRequestContext,
    reportId?: string,
    decisionId?: string,
  ) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${targetId} FOR UPDATE`;
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!target || target.deletedAt) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    this.policy.assertCanSanction(actor, target);

    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.type === UserSanctionType.SUSPENSION && (!endsAt || endsAt <= new Date())) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '暂停结束时间必须晚于当前时间');
    }
    if (dto.type === UserSanctionType.BAN && endsAt) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '永久封禁不能设置结束时间');
    }

    const now = new Date();
    const open = await tx.userSanction.findFirst({
      where: { userId: targetId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (open && isEffectiveSanction(open, now)) {
      if (open.type === UserSanctionType.BAN || dto.type === UserSanctionType.SUSPENSION) {
        throw conflict(ErrorCode.SANCTION_STATE_CONFLICT, '用户已有生效中的处罚');
      }
      await tx.userSanction.update({
        where: { id: open.id },
        data: {
          revokedAt: now,
          revokedById: actor.id,
          revokeReason: '升级为永久封禁',
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.USER_SANCTION_REVOKED,
          targetType: AuditTargetType.USER,
          targetId,
          reportId,
          reason: '升级为永久封禁',
          metadata: { sanctionId: open.id, actorUsername: actor.username },
          ...context,
        },
        tx,
      );
    } else if (open) {
      await tx.userSanction.update({
        where: { id: open.id },
        data: {
          revokedAt: now,
          revokedById: actor.id,
          revokeReason: '过期处罚归档',
        },
      });
    }

    const sanction = await tx.userSanction.create({
      data: {
        userId: targetId,
        type: dto.type,
        reason: dto.reason.trim(),
        reportId: reportId ?? null,
        createdById: actor.id,
        startsAt: now,
        endsAt,
        decisionId: decisionId ?? null,
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId: targetId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.audit.record(
      {
        actorId: actor.id,
        action:
          dto.type === UserSanctionType.BAN ? AuditAction.USER_BANNED : AuditAction.USER_SUSPENDED,
        targetType: AuditTargetType.USER,
        targetId,
        reportId,
        reason: dto.reason.trim(),
        metadata: {
          sanctionId: sanction.id,
          endsAt: sanction.endsAt?.toISOString() ?? null,
          actorUsername: actor.username,
        },
        ...context,
      },
      tx,
    );
    return sanction;
  }

  async revokeSanction(
    actor: AdminActor,
    targetId: string,
    reason: string,
    context: AdminRequestContext,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, deletedAt: true },
      });
      if (!target || target.deletedAt) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
      this.policy.assertCanSanction(actor, target);
      const sanction = await tx.userSanction.findFirst({
        where: { userId: targetId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!sanction || !isEffectiveSanction(sanction)) {
        throw conflict(ErrorCode.SANCTION_STATE_CONFLICT, '用户当前没有生效中的处罚');
      }
      const updated = await tx.userSanction.update({
        where: { id: sanction.id },
        data: {
          revokedAt: new Date(),
          revokedById: actor.id,
          revokeReason: reason.trim(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.USER_SANCTION_REVOKED,
          targetType: AuditTargetType.USER,
          targetId,
          reason: reason.trim(),
          metadata: { sanctionId: sanction.id, actorUsername: actor.username },
          ...context,
        },
        tx,
      );
      return updated;
    });
    this.finalizeUserMutation(targetId);
    return result;
  }

  async updateRole(
    actor: AdminActor,
    targetId: string,
    role: 'USER' | 'ADMIN',
    reason: string,
    context: AdminRequestContext,
  ) {
    if (role === UserRole.ADMIN) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '新增管理员必须使用邀请流程');
    }
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, deletedAt: true },
      });
      if (!target || target.deletedAt) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
      this.policy.assertCanManageRole(actor, target);
      if (target.role === role) {
        throw conflict(ErrorCode.CONFLICT, '用户已经是目标角色');
      }
      const updated = await tx.user.update({
        where: { id: targetId },
        data: { role },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.ADMIN_ROLE_REVOKED,
          targetType: AuditTargetType.USER,
          targetId,
          reason: reason.trim(),
          metadata: { previousRole: target.role, role, actorUsername: actor.username },
          ...context,
        },
        tx,
      );
      return updated;
    });
    this.finalizeUserMutation(targetId);
    return this.queries.getUser(targetId);
  }

  async hideContent(
    actor: AdminActor,
    targetType: 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
    targetId: string,
    reason: string,
    context: AdminRequestContext,
    reportId?: string,
  ) {
    const effect = await this.prisma.$transaction((tx) =>
      this.hideContentInTransaction(tx, actor, targetType, targetId, reason, context, reportId),
    );
    await this.finalizeContentMutation(effect);
    return this.toContentResponse(effect);
  }

  async hideContentInTransaction(
    tx: Prisma.TransactionClient,
    actor: AdminActor,
    targetType: 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
    targetId: string,
    reason: string,
    context: AdminRequestContext,
    reportId?: string,
  ): Promise<ContentModerationEffect> {
    const now = new Date();
    if (targetType === 'THREAD') {
      const thread = await tx.thread.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          published: true,
          visibility: true,
          deletedAt: true,
          removalSource: true,
        },
      });
      if (!thread || !thread.published || thread.visibility !== 'PUBLIC') {
        throw notFound(ErrorCode.THREAD_NOT_FOUND, '公开主题帖不存在');
      }
      if (thread.deletedAt) {
        throw conflict(
          ErrorCode.CONTENT_STATE_CONFLICT,
          thread.removalSource === ContentRemovalSource.ADMIN
            ? '主题帖已经被管理员隐藏'
            : '主题帖已由用户删除，不能改写其删除来源',
        );
      }
      await tx.thread.update({
        where: { id: targetId, deletedAt: null },
        data: {
          deletedAt: now,
          removalSource: ContentRemovalSource.ADMIN,
          removedById: actor.id,
          removalReason: reason.trim(),
        },
      });
    } else if (targetType === 'POST') {
      const post = await tx.post.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          deletedAt: true,
          removalSource: true,
          thread: { select: { published: true, visibility: true, deletedAt: true } },
          subthread: { select: { deletedAt: true } },
        },
      });
      if (
        !post ||
        !post.thread.published ||
        post.thread.visibility !== 'PUBLIC' ||
        post.thread.deletedAt ||
        post.subthread.deletedAt
      ) {
        throw notFound(ErrorCode.POST_NOT_FOUND, '公开帖子不存在');
      }
      if (post.deletedAt) {
        throw conflict(
          ErrorCode.CONTENT_STATE_CONFLICT,
          post.removalSource === ContentRemovalSource.ADMIN
            ? '帖子已经被管理员隐藏'
            : '帖子已由用户删除，不能改写其删除来源',
        );
      }
      await tx.post.update({
        where: { id: targetId, deletedAt: null },
        data: {
          deletedAt: now,
          removalSource: ContentRemovalSource.ADMIN,
          removedById: actor.id,
          removalReason: reason.trim(),
        },
      });
    } else if (targetType === 'MOMENT') {
      await this.lockMoment(tx, targetId);
      const moment = await tx.moment.findUnique({
        where: { id: targetId },
        select: { deletedAt: true, removalSource: true },
      });
      if (!moment) throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态不存在');
      if (moment.deletedAt) {
        throw conflict(
          ErrorCode.CONTENT_STATE_CONFLICT,
          moment.removalSource === ContentRemovalSource.ADMIN
            ? '动态已经被管理员隐藏'
            : '动态已由用户删除',
        );
      }
      await tx.moment.update({
        where: { id: targetId },
        data: {
          deletedAt: now,
          removalSource: ContentRemovalSource.ADMIN,
          removedById: actor.id,
          removalReason: reason.trim(),
        },
      });
    } else {
      const target = await tx.momentComment.findUnique({
        where: { id: targetId },
        select: { momentId: true },
      });
      if (!target) throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态评论不存在');
      await this.lockMoment(tx, target.momentId);
      await this.lockMomentComment(tx, targetId);
      const comment = await tx.momentComment.findUnique({
        where: { id: targetId },
        select: {
          momentId: true,
          deletedAt: true,
          removalSource: true,
          moment: { select: { deletedAt: true } },
        },
      });
      if (!comment || comment.moment.deletedAt)
        throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态评论不存在');
      if (comment.deletedAt) {
        throw conflict(
          ErrorCode.CONTENT_STATE_CONFLICT,
          comment.removalSource === ContentRemovalSource.ADMIN
            ? '评论已经被管理员隐藏'
            : '评论已由用户删除',
        );
      }
      await tx.momentComment.update({
        where: { id: targetId },
        data: {
          deletedAt: now,
          removalSource: ContentRemovalSource.ADMIN,
          removedById: actor.id,
          removalReason: reason.trim(),
        },
      });
      const updated = await tx.moment.updateMany({
        where: { id: comment.momentId, deletedAt: null },
        data: { commentCount: { decrement: 1 } },
      });
      if (updated.count === 0) {
        throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '所属动态已不可见，不能隐藏评论');
      }
    }
    await this.audit.record(
      {
        actorId: actor.id,
        action: AuditAction.CONTENT_HIDDEN,
        targetType:
          targetType === 'THREAD'
            ? AuditTargetType.THREAD
            : targetType === 'POST'
              ? AuditTargetType.POST
              : targetType === 'MOMENT'
                ? AuditTargetType.MOMENT
                : AuditTargetType.MOMENT_COMMENT,
        targetId,
        reportId,
        reason: reason.trim(),
        metadata: { actorUsername: actor.username },
        ...context,
      },
      tx,
    );
    return this.loadContentEffect(tx, targetType, targetId, true, now);
  }

  async restoreContent(
    actor: AdminActor,
    targetType: 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
    targetId: string,
    reason: string,
    context: AdminRequestContext,
  ) {
    const effect = await this.prisma.$transaction(async (tx) => {
      if (targetType === 'THREAD') {
        const thread = await tx.thread.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            published: true,
            visibility: true,
            deletedAt: true,
            removalSource: true,
          },
        });
        if (!thread || !thread.published || thread.visibility !== 'PUBLIC') {
          throw notFound(ErrorCode.THREAD_NOT_FOUND, '公开主题帖不存在');
        }
        if (!thread.deletedAt || thread.removalSource !== ContentRemovalSource.ADMIN) {
          throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '只能恢复由管理员隐藏的主题帖');
        }
        await tx.thread.update({
          where: { id: targetId },
          data: { deletedAt: null, removalSource: null, removedById: null, removalReason: null },
        });
      } else if (targetType === 'POST') {
        const post = await tx.post.findUnique({
          where: { id: targetId },
          select: {
            id: true,
            deletedAt: true,
            removalSource: true,
            thread: { select: { published: true, visibility: true, deletedAt: true } },
            subthread: { select: { deletedAt: true } },
          },
        });
        if (!post) throw notFound(ErrorCode.POST_NOT_FOUND, '帖子不存在');
        if (!post.deletedAt || post.removalSource !== ContentRemovalSource.ADMIN) {
          throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '只能恢复由管理员隐藏的帖子');
        }
        if (
          !post.thread.published ||
          post.thread.visibility !== 'PUBLIC' ||
          post.thread.deletedAt ||
          post.subthread.deletedAt
        ) {
          throw conflict(
            ErrorCode.CONTENT_STATE_CONFLICT,
            '父级主题帖或子贴仍不可见，不能恢复帖子',
          );
        }
        await tx.post.update({
          where: { id: targetId },
          data: { deletedAt: null, removalSource: null, removedById: null, removalReason: null },
        });
      } else if (targetType === 'MOMENT') {
        await this.lockMoment(tx, targetId);
        const moment = await tx.moment.findUnique({
          where: { id: targetId },
          select: { deletedAt: true, removalSource: true },
        });
        if (!moment) throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态不存在');
        if (!moment.deletedAt || moment.removalSource !== ContentRemovalSource.ADMIN) {
          throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '只能恢复由管理员隐藏的动态');
        }
        await tx.moment.update({
          where: { id: targetId },
          data: { deletedAt: null, removalSource: null, removedById: null, removalReason: null },
        });
      } else {
        const target = await tx.momentComment.findUnique({
          where: { id: targetId },
          select: { momentId: true },
        });
        if (!target) throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态评论不存在');
        await this.lockMoment(tx, target.momentId);
        await this.lockMomentComment(tx, targetId);
        const comment = await tx.momentComment.findUnique({
          where: { id: targetId },
          select: {
            deletedAt: true,
            removalSource: true,
            momentId: true,
            moment: { select: { deletedAt: true } },
          },
        });
        if (!comment) throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态评论不存在');
        if (!comment.deletedAt || comment.removalSource !== ContentRemovalSource.ADMIN) {
          throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '只能恢复由管理员隐藏的动态评论');
        }
        if (comment.moment.deletedAt)
          throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '所属动态仍不可见，不能恢复评论');
        await tx.momentComment.update({
          where: { id: targetId },
          data: { deletedAt: null, removalSource: null, removedById: null, removalReason: null },
        });
        const updated = await tx.moment.updateMany({
          where: { id: comment.momentId, deletedAt: null },
          data: { commentCount: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw conflict(ErrorCode.CONTENT_STATE_CONFLICT, '所属动态仍不可见，不能恢复评论');
        }
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.CONTENT_RESTORED,
          targetType:
            targetType === 'THREAD'
              ? AuditTargetType.THREAD
              : targetType === 'POST'
                ? AuditTargetType.POST
                : targetType === 'MOMENT'
                  ? AuditTargetType.MOMENT
                  : AuditTargetType.MOMENT_COMMENT,
          targetId,
          reason: reason.trim(),
          metadata: { actorUsername: actor.username },
          ...context,
        },
        tx,
      );
      return this.loadContentEffect(tx, targetType, targetId, false, null);
    });
    await this.finalizeContentMutation(effect);
    return this.toContentResponse(effect);
  }

  finalizeUserMutation(userId: string) {
    this.projections.finalizeUser(userId);
  }

  async finalizeContentMutation(effect: ContentModerationEffect) {
    await this.projections.finalizeContent(effect);
  }

  private async lockMoment(tx: Prisma.TransactionClient, momentId: string) {
    await tx.$queryRaw`SELECT "id" FROM "moments" WHERE "id" = ${momentId} FOR UPDATE`;
  }

  private async lockMomentComment(tx: Prisma.TransactionClient, commentId: string) {
    await tx.$queryRaw`
      SELECT "id" FROM "moment_comments" WHERE "id" = ${commentId} FOR UPDATE
    `;
  }

  private async loadContentEffect(
    tx: Prisma.TransactionClient,
    targetType: 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
    targetId: string,
    hidden: boolean,
    deletedAt: Date | null,
  ): Promise<ContentModerationEffect> {
    if (targetType === 'THREAD') {
      return { targetType, targetId, hidden, deletedAt, threadId: targetId };
    }
    if (targetType === 'MOMENT') {
      return { targetType, targetId, hidden, deletedAt, momentId: targetId };
    }
    if (targetType === 'MOMENT_COMMENT') {
      const comment = await tx.momentComment.findUniqueOrThrow({
        where: { id: targetId },
        select: { momentId: true },
      });
      return { targetType, targetId, hidden, deletedAt, momentId: comment.momentId };
    }
    const post = await tx.post.findUniqueOrThrow({
      where: { id: targetId },
      select: { threadId: true, parentPostId: true },
    });
    return { targetType, targetId, hidden, deletedAt, ...post };
  }

  private toContentResponse(effect: ContentModerationEffect) {
    return {
      targetType: effect.targetType,
      targetId: effect.targetId,
      hidden: effect.hidden,
      deletedAt: effect.deletedAt,
    };
  }
}
