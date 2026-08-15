import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminInviteStatus,
  AuditAction,
  AuditTargetType,
  UserRole,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AuditService } from './audit.service';
import { AdminActor } from './admin-policy.service';
import { AdminRequestContext } from './moderation.service';

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function conflict(code: number, message: string) {
  return new BusinessException(code, message, HttpStatus.CONFLICT);
}

@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async list() {
    const [accounts, invites] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] }, deletedAt: null },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          createdAt: true,
          adminSessions: {
            where: { revokedAt: null, expiresAt: { gt: new Date() } },
            select: { id: true, lastActiveAt: true, expiresAt: true },
          },
        },
        orderBy: [{ role: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.adminInvite.findMany({
        where: { status: AdminInviteStatus.PENDING },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          user: { select: { id: true, email: true, username: true } },
          invitedBy: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { accounts, invites };
  }

  async invite(actor: AdminActor, userId: string, context: AdminRequestContext) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, role: true, deletedAt: true },
    });
    if (!target || target.deletedAt) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    if (target.role !== UserRole.USER) {
      throw conflict(ErrorCode.ADMIN_INVITE_CONFLICT, '该用户已经是管理员');
    }
    const rawToken = randomBytes(32).toString('base64url');
    const invite = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.adminInvite.create({
          data: {
            userId,
            invitedById: actor.id,
            tokenHash: this.hash(rawToken),
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
          select: { id: true, expiresAt: true, user: { select: { email: true } } },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: AuditAction.ADMIN_INVITED,
            targetType: AuditTargetType.ADMIN_INVITE,
            targetId: created.id,
            metadata: { userId, actorUsername: actor.username },
            ...context,
          },
          tx,
        );
        return created;
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === 'P2002') {
          throw conflict(ErrorCode.ADMIN_INVITE_CONFLICT, '该用户已有待处理的管理员邀请');
        }
        throw error;
      });
    const baseUrl =
      this.config.get<string>('app.adminWebEntryUrl') ||
      `${this.config.get<string>('app.webUrl') ?? 'http://localhost:3001'}/station/invite`;
    await this.email.sendAdminInvite(invite.user.email, `${baseUrl}?token=${encodeURIComponent(rawToken)}`);
    return { id: invite.id, expiresAt: invite.expiresAt };
  }

  async accept(rawToken: string, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const invite = await tx.adminInvite.findUnique({
        where: { tokenHash: this.hash(rawToken) },
        include: { user: { select: { role: true, deletedAt: true } } },
      });
      if (!invite || invite.userId !== userId || invite.status !== AdminInviteStatus.PENDING) {
        throw notFound(ErrorCode.NOT_FOUND, '管理员邀请不存在');
      }
      if (invite.expiresAt <= new Date()) {
        await tx.adminInvite.update({ where: { id: invite.id }, data: { status: AdminInviteStatus.EXPIRED } });
        throw conflict(ErrorCode.ADMIN_INVITE_CONFLICT, '管理员邀请已过期');
      }
      if (invite.user.deletedAt || invite.user.role !== UserRole.USER) {
        throw conflict(ErrorCode.ADMIN_INVITE_CONFLICT, '账号状态已变化，无法接受邀请');
      }
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: { role: UserRole.ADMIN },
      });
      await tx.adminInvite.update({
        where: { id: invite.id },
        data: { status: AdminInviteStatus.ACCEPTED, acceptedAt: now },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          actorId: userId,
          action: AuditAction.ADMIN_INVITE_ACCEPTED,
          targetType: AuditTargetType.ADMIN_INVITE,
          targetId: invite.id,
          metadata: { userId },
        },
        tx,
      );
    });
    return { message: '邀请已接受，请从站务台重新登录' };
  }

  async cancel(actor: AdminActor, inviteId: string, reason: string, context: AdminRequestContext) {
    const invite = await this.prisma.adminInvite.findUnique({ where: { id: inviteId } });
    if (!invite) throw notFound(ErrorCode.NOT_FOUND, '管理员邀请不存在');
    if (invite.status !== AdminInviteStatus.PENDING) {
      throw conflict(ErrorCode.ADMIN_INVITE_CONFLICT, '邀请已经处理');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.adminInvite.update({
        where: { id: inviteId },
        data: { status: AdminInviteStatus.CANCELED, canceledAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.ADMIN_INVITE_CANCELED,
          targetType: AuditTargetType.ADMIN_INVITE,
          targetId: inviteId,
          reason: reason.trim(),
          ...context,
        },
        tx,
      );
    });
    return { message: '邀请已取消' };
  }

  async revoke(actor: AdminActor, userId: string, reason: string, context: AdminRequestContext) {
    if (actor.id === userId) throw conflict(ErrorCode.CANNOT_MODERATE_ADMIN, '不能撤销自己的管理员身份');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    if (target.role !== UserRole.ADMIN) {
      throw conflict(ErrorCode.ADMIN_INVITE_CONFLICT, '目标不是普通管理员');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role: UserRole.USER } });
      await tx.adminSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.ADMIN_ROLE_REVOKED,
          targetType: AuditTargetType.USER,
          targetId: userId,
          reason: reason.trim(),
          metadata: { actorUsername: actor.username },
          ...context,
        },
        tx,
      );
    });
    return { message: '管理员身份已撤销' };
  }

  async transferSuperAdmin(
    actor: AdminActor,
    targetId: string,
    reason: string,
    context: AdminRequestContext,
  ) {
    if (actor.id === targetId) throw conflict(ErrorCode.CONFLICT, '接任人不能是自己');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
    if (!target) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    if (target.role !== UserRole.ADMIN) {
      throw conflict(ErrorCode.CONFLICT, '接任人必须已经是普通管理员');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { role: UserRole.ADMIN } });
      await tx.user.update({ where: { id: targetId }, data: { role: UserRole.SUPER_ADMIN } });
      await tx.adminSession.updateMany({
        where: { userId: { in: [actor.id, targetId] }, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.refreshToken.updateMany({
        where: { userId: { in: [actor.id, targetId] }, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.SUPER_ADMIN_TRANSFERRED,
          targetType: AuditTargetType.USER,
          targetId,
          reason: reason.trim(),
          metadata: { previousSuperAdminId: actor.id, newSuperAdminId: targetId },
          ...context,
        },
        tx,
      );
    });
    return { message: '超级管理员已移交，双方需要重新登录站务台' };
  }
}
