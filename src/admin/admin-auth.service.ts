import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminSecurityEventType,
  Prisma,
  UserRole,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { activeSanctionWhere, sanctionFailure } from '../auth/account-sanction';
import { unauthorized, forbidden } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AdminLoginChallengeDto } from './dto/admin-auth.dto';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const SECURITY_EVENT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;

interface RequestFingerprint {
  ip?: string;
  userAgent?: string;
}

interface AdminPrincipal {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  emailVerified: boolean;
  adminSessionId: string;
  elevatedUntil?: string;
}

/** 与普通用户 JWT 完全隔离的管理员浏览器会话和邮箱二次验证。 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private challengeHash(challengeId: string, code: string): string {
    const pepper = this.config.get<string>('admin.challengePepper') ?? '';
    return this.hash(`${challengeId}:${code}:${pepper}`);
  }

  private codeMatches(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(actual, 'hex');
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private async securityEvent(
    type: AdminSecurityEventType,
    userId: string | null,
    fingerprint: RequestFingerprint,
    metadata?: Prisma.InputJsonObject,
  ) {
    await this.prisma.adminSecurityEvent.create({
      data: {
        type,
        userId,
        ip: fingerprint.ip,
        userAgent: fingerprint.userAgent?.slice(0, 512),
        metadata: metadata ?? Prisma.JsonNull,
        expiresAt: new Date(Date.now() + SECURITY_EVENT_TTL_MS),
      },
    });
  }

  async createLoginChallenge(dto: AdminLoginChallengeDto, fingerprint: RequestFingerprint) {
    const account = dto.account.trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: account.toLowerCase() }, { username: account }],
      },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        emailVerified: true,
        deletedAt: true,
        lockedUntil: true,
        sanctions: {
          where: activeSanctionWhere(),
          take: 1,
          select: { type: true, endsAt: true },
        },
      },
    });

    const allowedRole = user?.role === UserRole.ADMIN || user?.role === UserRole.SUPER_ADMIN;
    const passwordValid = user
      ? await argon2.verify(user.password, dto.password)
      : await argon2.hash(dto.password).then(() => false);
    const unavailable = !user || user.deletedAt || !user.emailVerified || !allowedRole;
    if (unavailable || !passwordValid || (user.lockedUntil && user.lockedUntil > new Date())) {
      await this.securityEvent(
        AdminSecurityEventType.LOGIN_FAILED,
        user?.id ?? null,
        fingerprint,
        { stage: 'password' },
      );
      throw unauthorized('管理员账号或密码错误', ErrorCode.LOGIN_FAILED);
    }

    const sanction = sanctionFailure(user.sanctions[0]);
    if (sanction) throw unauthorized(sanction.message, sanction.code);

    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await this.prisma.$transaction([
      this.prisma.adminAuthChallenge.updateMany({
        where: { userId: user.id, purpose: 'LOGIN', consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.adminAuthChallenge.create({
        data: {
          id: challengeId,
          userId: user.id,
          purpose: 'LOGIN',
          codeHash: this.challengeHash(challengeId, code),
          expiresAt,
        },
      }),
    ]);
    await this.securityEvent(AdminSecurityEventType.LOGIN_CHALLENGE_CREATED, user.id, fingerprint);
    await this.email.sendAdminVerification(user.email, code, 'LOGIN');
    return { challengeId, expiresIn: CHALLENGE_TTL_MS / 1000 };
  }

  async verifyLoginChallenge(challengeId: string, code: string, fingerprint: RequestFingerprint) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const challenge = await tx.adminAuthChallenge.findUnique({
        where: { id: challengeId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              role: true,
              emailVerified: true,
              deletedAt: true,
              sanctions: {
                where: activeSanctionWhere(),
                take: 1,
                select: { type: true, endsAt: true },
              },
            },
          },
        },
      });
      const codeHash = this.challengeHash(challengeId, code);
      const invalid =
        !challenge ||
        challenge.purpose !== 'LOGIN' ||
        challenge.consumedAt !== null ||
        challenge.expiresAt <= new Date() ||
        challenge.attempts >= MAX_CHALLENGE_ATTEMPTS ||
        !this.codeMatches(challenge.codeHash, codeHash);
      if (invalid) {
        if (challenge && !challenge.consumedAt) {
          await tx.adminAuthChallenge.update({
            where: { id: challenge.id },
            data: { attempts: { increment: 1 } },
          });
        }
        return { ok: false as const, userId: challenge?.userId ?? null };
      }

      const user = challenge.user;
      const roleAllowed = user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
      if (user.deletedAt || !user.emailVerified || !roleAllowed || sanctionFailure(user.sanctions[0])) {
        await tx.adminAuthChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
        return { ok: false as const, userId: user.id };
      }

      const rawToken = randomBytes(32).toString('base64url');
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + (this.config.get<number>('admin.absoluteHours') ?? 8) * 60 * 60 * 1000,
      );
      await tx.adminAuthChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now } });
      await tx.adminSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      const session = await tx.adminSession.create({
        data: {
          userId: user.id,
          tokenHash: this.hash(rawToken),
          ip: fingerprint.ip,
          userAgent: fingerprint.userAgent?.slice(0, 512),
          expiresAt,
        },
      });
      return { ok: true as const, rawToken, session, user };
    });

    if (!outcome.ok) {
      await this.securityEvent(AdminSecurityEventType.LOGIN_FAILED, outcome.userId, fingerprint, {
        stage: 'email_code',
      });
      throw unauthorized('验证码无效或已过期', ErrorCode.ADMIN_CHALLENGE_INVALID);
    }

    await this.securityEvent(AdminSecurityEventType.LOGIN_SUCCEEDED, outcome.user.id, fingerprint, {
      sessionId: outcome.session.id,
    });
    this.email
      .sendAdminSessionAlert(outcome.user.email, outcome.session.createdAt, fingerprint.ip)
      .catch((error: unknown) => this.logger.warn({ error }, '管理员登录提醒邮件发送失败'));
    return {
      rawToken: outcome.rawToken,
      session: {
        id: outcome.session.id,
        expiresAt: outcome.session.expiresAt,
        idleMinutes: this.config.get<number>('admin.idleMinutes') ?? 30,
      },
      user: {
        id: outcome.user.id,
        email: outcome.user.email,
        username: outcome.user.username,
        role: outcome.user.role,
      },
    };
  }

  async validateSession(rawToken?: string): Promise<AdminPrincipal> {
    if (!rawToken) {
      throw unauthorized('需要管理员会话', ErrorCode.ADMIN_SESSION_REQUIRED);
    }
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            emailVerified: true,
            deletedAt: true,
            sanctions: {
              where: activeSanctionWhere(),
              take: 1,
              select: { type: true, endsAt: true },
            },
          },
        },
      },
    });
    const now = new Date();
    const idleLimit = (this.config.get<number>('admin.idleMinutes') ?? 30) * 60 * 1000;
    const roleAllowed =
      session?.user.role === UserRole.ADMIN || session?.user.role === UserRole.SUPER_ADMIN;
    const invalid =
      !session ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      now.getTime() - session.lastActiveAt.getTime() > idleLimit ||
      session.user.deletedAt !== null ||
      !session.user.emailVerified ||
      !roleAllowed ||
      Boolean(sanctionFailure(session.user.sanctions[0]));
    if (invalid) {
      if (session && !session.revokedAt) {
        await this.prisma.adminSession.update({
          where: { id: session.id },
          data: { revokedAt: now },
        });
      }
      throw unauthorized('管理员会话已失效，请重新登录', ErrorCode.ADMIN_SESSION_EXPIRED);
    }

    if (now.getTime() - session.lastActiveAt.getTime() > 60_000) {
      await this.prisma.adminSession.update({
        where: { id: session.id },
        data: { lastActiveAt: now },
      });
    }
    return {
      id: session.user.id,
      email: session.user.email,
      username: session.user.username,
      role: session.user.role,
      emailVerified: true,
      adminSessionId: session.id,
      elevatedUntil: session.elevatedUntil?.toISOString(),
    };
  }

  async getSession(sessionId: string) {
    const session = await this.prisma.adminSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { id: true, createdAt: true, lastActiveAt: true, expiresAt: true, elevatedUntil: true },
    });
    return { session };
  }

  async logout(sessionId: string, fingerprint: RequestFingerprint) {
    const session = await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
      select: { userId: true },
    });
    await this.securityEvent(AdminSecurityEventType.SESSION_REVOKED, session.userId, fingerprint, {
      sessionId,
    });
    return { message: '已退出站务台' };
  }

  async createStepUpChallenge(userId: string, fingerprint: RequestFingerprint) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const challengeId = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.$transaction([
      this.prisma.adminAuthChallenge.updateMany({
        where: { userId, purpose: 'STEP_UP', consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.adminAuthChallenge.create({
        data: {
          id: challengeId,
          userId,
          purpose: 'STEP_UP',
          codeHash: this.challengeHash(challengeId, code),
          expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        },
      }),
    ]);
    await this.securityEvent(AdminSecurityEventType.LOGIN_CHALLENGE_CREATED, userId, fingerprint, {
      purpose: 'STEP_UP',
    });
    await this.email.sendAdminVerification(user.email, code, 'STEP_UP');
    return { challengeId, expiresIn: CHALLENGE_TTL_MS / 1000 };
  }

  async verifyStepUp(
    sessionId: string,
    userId: string,
    challengeId: string,
    code: string,
    fingerprint: RequestFingerprint,
  ) {
    const challenge = await this.prisma.adminAuthChallenge.findFirst({
      where: { id: challengeId, userId, purpose: 'STEP_UP' },
    });
    const actualHash = this.challengeHash(challengeId, code);
    const invalid =
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= MAX_CHALLENGE_ATTEMPTS ||
      !this.codeMatches(challenge.codeHash, actualHash);
    if (invalid) {
      if (challenge && !challenge.consumedAt) {
        await this.prisma.adminAuthChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
      }
      await this.securityEvent(AdminSecurityEventType.STEP_UP_FAILED, userId, fingerprint);
      throw unauthorized('验证码无效或已过期', ErrorCode.ADMIN_CHALLENGE_INVALID);
    }
    const elevatedUntil = new Date(
      Date.now() + (this.config.get<number>('admin.stepUpMinutes') ?? 10) * 60 * 1000,
    );
    await this.prisma.$transaction([
      this.prisma.adminAuthChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.adminSession.update({
        where: { id: sessionId },
        data: { elevatedUntil },
      }),
    ]);
    await this.securityEvent(AdminSecurityEventType.STEP_UP_SUCCEEDED, userId, fingerprint, {
      sessionId,
    });
    return { elevatedUntil };
  }

  requireStepUp(elevatedUntil?: string) {
    if (!elevatedUntil || new Date(elevatedUntil) <= new Date()) {
      throw forbidden('请先完成邮箱二次确认', ErrorCode.ADMIN_STEP_UP_REQUIRED);
    }
  }
}
