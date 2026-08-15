import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { EmailVerification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { VerificationCodeService, VERIFICATION_CODE_TTL } from './verification-code.service';
import { LoginDto } from './dto/login.dto';
import { VerifyAndCompleteDto } from './dto/verify-and-complete.dto';
import { ClientPlatform } from './client-platform';
import { AuthSessionService } from './auth-session.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { BusinessException, unauthorized } from '../common/exceptions/business.exception';

const userSelectPublic = {
  id: true,
  email: true,
  username: true,
  avatar: true,
  role: true,
  level: true,
} as const;

const MAX_VERIFICATION_ATTEMPTS = 5;
const AUTH_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

type VerificationFailure = {
  ok: false;
  message: string;
  code: ErrorCode;
};

type VerificationResult<T> = { ok: true; value: T } | VerificationFailure;

@Injectable()
/** 认证服务：注册验证码、登录、Token 刷新、密码管理、双端登录终端 */
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailService: EmailService,
    private verificationCodeService: VerificationCodeService,
    private sessions: AuthSessionService,
  ) {}

  /**
   * 在事务内锁定并消费验证码。错误尝试的计数/删除先提交，再在事务外抛错，
   * 避免异常回滚安全状态；同一验证码的并发请求会被行锁串行化。
   */
  private async consumeVerification<T>(
    options: {
      where: Prisma.EmailVerificationWhereInput;
      inputCode: string;
      missing: Omit<VerificationFailure, 'ok'>;
      lockUserId?: string;
    },
    onVerified: (tx: Prisma.TransactionClient, record: EmailVerification) => Promise<T>,
  ): Promise<T> {
    const initial = await this.prisma.emailVerification.findFirst({ where: options.where });
    if (!initial) {
      throw unauthorized(options.missing.message, options.missing.code);
    }

    const result = await this.prisma.$transaction<VerificationResult<T>>(async (tx) => {
      if (options.lockUserId) {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${options.lockUserId} FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT id FROM email_verifications WHERE id = ${initial.id} FOR UPDATE`;

      const record = await tx.emailVerification.findFirst({
        where: { AND: [{ id: initial.id }, options.where] },
      });
      const failure = await this.checkVerificationCode(
        tx,
        record,
        options.inputCode,
        options.missing,
      );
      if (failure) return failure;

      const value = await onVerified(tx, record!);
      await tx.emailVerification.delete({ where: { id: record!.id } });
      return { ok: true, value };
    }, AUTH_TRANSACTION_OPTIONS);

    if (!result.ok) {
      throw unauthorized(result.message, result.code);
    }
    return result.value;
  }

  private async checkVerificationCode(
    tx: Prisma.TransactionClient,
    record: EmailVerification | null,
    inputCode: string,
    missing: Omit<VerificationFailure, 'ok'>,
  ): Promise<VerificationFailure | null> {
    if (!record) return { ok: false, ...missing };

    if (record.expiresAt <= new Date()) {
      await tx.emailVerification.delete({ where: { id: record.id } });
      return {
        ok: false,
        message: '验证码已过期，请重新获取',
        code: ErrorCode.CODE_EXPIRED,
      };
    }

    if (record.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      await tx.emailVerification.delete({ where: { id: record.id } });
      return {
        ok: false,
        message: '验证码尝试次数过多，请重新获取',
        code: ErrorCode.CODE_ATTEMPTS_EXCEEDED,
      };
    }

    if (record.token !== inputCode) {
      const nextAttempts = record.attempts + 1;
      if (nextAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        await tx.emailVerification.delete({ where: { id: record.id } });
        return {
          ok: false,
          message: '验证码尝试次数过多，请重新获取',
          code: ErrorCode.CODE_ATTEMPTS_EXCEEDED,
        };
      }
      await tx.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, message: '验证码错误', code: ErrorCode.CODE_INVALID };
    }

    return null;
  }

  /** 注册第一步：请求邮箱验证码 */
  async requestCode(rawEmail: string) {
    const email = rawEmail.toLowerCase().trim();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BusinessException(
        ErrorCode.EMAIL_ALREADY_REGISTERED,
        '该邮箱已被注册',
        HttpStatus.CONFLICT,
      );
    }

    const { emailSent } = await this.verificationCodeService.issue({
      type: 'REGISTRATION',
      email,
      label: '注册验证邮件',
      send: (code) => this.emailService.sendVerification(email, code, 'REGISTRATION'),
    });

    return {
      emailSent,
      codeExpiresIn: VERIFICATION_CODE_TTL / 1000,
      message: '验证码已发送，请查收邮箱',
    };
  }

  /** 注册第二步：验证邮箱验证码 + 设置用户名密码，一步完成注册 */
  async verifyAndComplete(
    dto: VerifyAndCompleteDto,
    deviceInfo?: string,
    platform: ClientPlatform = 'web',
  ) {
    const email = dto.email.toLowerCase().trim();

    try {
      const user = await this.consumeVerification(
        {
          where: { email, type: 'REGISTRATION' },
          inputCode: dto.code,
          missing: {
            message: '请先获取邮箱验证码',
            code: ErrorCode.NO_CODE_RECORD,
          },
        },
        async (tx) => {
          const password = await argon2.hash(dto.password, {
            timeCost: this.configService.get<number>('argon2.timeCost')!,
            memoryCost: this.configService.get<number>('argon2.memoryCost')!,
          });
          const created = await tx.user.create({
            data: {
              email,
              username: dto.username,
              password,
              bookmarkFolders: {
                create: { name: '默认收藏夹', isDefault: true },
              },
            },
            select: userSelectPublic,
          });
          await tx.wallet.create({ data: { kind: 'USER', userId: created.id } });
          return created;
        },
      );

      const { accessToken, refreshToken } = await this.sessions.createSession(
        user.id,
        deviceInfo ?? null,
        platform,
      );
      return { accessToken, refreshToken, user, message: '注册成功' };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const rawTarget = (e.meta as Record<string, unknown> | null)?.target;
        const targets = Array.isArray(rawTarget)
          ? rawTarget.map(String)
          : [String(rawTarget ?? '')];
        if (targets.some((target) => target.includes('username'))) {
          throw new BusinessException(
            ErrorCode.USERNAME_TAKEN,
            '该用户名已被占用',
            HttpStatus.CONFLICT,
          );
        }
        if (targets.some((target) => target.includes('email'))) {
          throw new BusinessException(
            ErrorCode.EMAIL_ALREADY_REGISTERED,
            '该邮箱已被注册',
            HttpStatus.CONFLICT,
          );
        }
      }
      throw e;
    }
  }

  async login(dto: LoginDto, deviceInfo?: string, platform: ClientPlatform = 'web') {
    return this.sessions.login(dto, deviceInfo, platform);
  }

  async refresh(rawRefreshToken: string) {
    return this.sessions.refresh(rawRefreshToken);
  }

  /** 修改密码：旧密码校验 + 吊销全部会话 + 发送通知邮件 */
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, email: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw unauthorized('登录状态无效', ErrorCode.UNAUTHORIZED);

    if (oldPassword === newPassword) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '新密码不能与旧密码相同');
    }

    const valid = await argon2.verify(user.password, oldPassword);
    if (!valid) throw unauthorized('原密码错误', ErrorCode.WRONG_OLD_PASSWORD);

    const hashed = await argon2.hash(newPassword, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });

    const notificationEmail = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { password: true, email: true, deletedAt: true },
      });
      if (!current || current.deletedAt) {
        throw unauthorized('登录状态无效', ErrorCode.UNAUTHORIZED);
      }
      if (!(await argon2.verify(current.password, oldPassword))) {
        throw unauthorized('原密码错误', ErrorCode.WRONG_OLD_PASSWORD);
      }

      await tx.user.update({
        where: { id: userId },
        data: { password: hashed },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.emailVerification.deleteMany({
        where: { userId, type: { in: ['PASSWORD_RESET', 'CHANGE_EMAIL'] } },
      });
      return current.email;
    }, AUTH_TRANSACTION_OPTIONS);

    this.emailService.sendPasswordChanged(notificationEmail).catch((err) => {
      this.logger.error('密码修改通知邮件发送失败', err);
    });

    return { message: '密码已修改，请重新登录' };
  }

  /** 忘记密码 — 发送重置邮件 */
  async forgotPassword(rawEmail: string) {
    const email = rawEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
    });
    if (!user) return { message: '如果该邮箱已注册，重置邮件已发送' };

    await this.verificationCodeService.issue({
      type: 'PASSWORD_RESET',
      userId: user.id,
      email,
      label: '重置密码邮件',
      send: (code) => this.emailService.sendPasswordReset(email, code),
    });

    return { message: '如果该邮箱已注册，重置邮件已发送' };
  }

  /** 重置密码 + 吊销全部会话（按 email+type 锚定，避免 token 跨用户碰撞） */
  async resetPassword(rawEmail: string, inputToken: string, newPassword: string) {
    const email = rawEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw unauthorized('验证码错误', ErrorCode.CODE_INVALID);

    return this.consumeVerification(
      {
        where: { email, userId: user.id, type: 'PASSWORD_RESET' },
        inputCode: inputToken,
        missing: { message: '验证码错误', code: ErrorCode.CODE_INVALID },
        lockUserId: user.id,
      },
      async (tx, record) => {
        const current = await tx.user.findFirst({
          where: { id: user.id, email, deletedAt: null },
          select: { id: true },
        });
        if (!current) throw unauthorized('验证码错误', ErrorCode.CODE_INVALID);

        const hashed = await argon2.hash(newPassword, {
          timeCost: this.configService.get<number>('argon2.timeCost')!,
          memoryCost: this.configService.get<number>('argon2.memoryCost')!,
        });
        await tx.user.update({
          where: { id: user.id },
          data: { password: hashed },
        });
        await tx.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.emailVerification.deleteMany({
          where: {
            userId: user.id,
            type: { in: ['PASSWORD_RESET', 'CHANGE_EMAIL'] },
            id: { not: record.id },
          },
        });
        return { message: '密码已重置，请重新登录' };
      },
    );
  }

  /** 更换邮箱第一步：向新邮箱发送 6 位验证码 */
  async requestChangeEmailCode(userId: string, newEmail: string, oldPassword: string) {
    const normalized = newEmail.toLowerCase().trim();
    let code: string;
    try {
      code = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
        const currentUser = await tx.user.findUnique({
          where: { id: userId },
          select: { email: true, password: true, deletedAt: true },
        });
        if (!currentUser || currentUser.deletedAt) {
          throw unauthorized('登录状态无效', ErrorCode.UNAUTHORIZED);
        }
        if (currentUser.email === normalized) {
          throw new BusinessException(ErrorCode.BAD_REQUEST, '新邮箱不能与当前邮箱相同');
        }

        // 与改密码共用用户行锁并在锁内复查，旧密码验证后不能再并发创建换邮箱码。
        const valid = await argon2.verify(currentUser.password, oldPassword);
        if (!valid) throw unauthorized('当前密码错误', ErrorCode.WRONG_OLD_PASSWORD);

        const existing = await tx.user.findUnique({
          where: { email: normalized, deletedAt: null },
        });
        if (existing) {
          throw new BusinessException(
            ErrorCode.EMAIL_ALREADY_REGISTERED,
            '该邮箱已被其他用户使用',
            HttpStatus.CONFLICT,
          );
        }

        const prepared = await this.verificationCodeService.prepareInTransaction(
          {
            type: 'CHANGE_EMAIL',
            userId,
            email: normalized,
            resendIfSameEmail: true,
          },
          tx,
        );
        return prepared.code;
      }, AUTH_TRANSACTION_OPTIONS);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该邮箱已有换绑请求，请稍后重试',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    await this.verificationCodeService.deliver('更换邮箱验证码', () =>
      this.emailService.sendVerification(normalized, code, 'CHANGE_EMAIL'),
    );

    return { message: '验证码已发送，请查收新邮箱' };
  }

  /** 更换邮箱第二步：验证码确认后更新 email */
  async verifyChangeEmail(userId: string, newEmail: string, inputCode: string) {
    const normalized = newEmail.toLowerCase().trim();
    try {
      await this.consumeVerification(
        {
          where: { userId, type: 'CHANGE_EMAIL', email: normalized },
          inputCode,
          missing: { message: '请先请求验证码', code: ErrorCode.NO_CODE_RECORD },
          lockUserId: userId,
        },
        async (tx, record) => {
          const current = await tx.user.findUnique({
            where: { id: userId },
            select: { email: true, deletedAt: true },
          });
          if (!current || current.deletedAt) {
            throw unauthorized('登录状态无效', ErrorCode.UNAUTHORIZED);
          }
          if (current.email === normalized) {
            throw new BusinessException(ErrorCode.BAD_REQUEST, '新邮箱不能与当前邮箱相同');
          }

          const existing = await tx.user.findFirst({
            where: { email: normalized, deletedAt: null, id: { not: userId } },
            select: { id: true },
          });
          if (existing) {
            throw new BusinessException(
              ErrorCode.EMAIL_ALREADY_REGISTERED,
              '该邮箱已被其他用户使用',
              HttpStatus.CONFLICT,
            );
          }

          await tx.user.update({
            where: { id: userId },
            data: { email: normalized },
          });
          await tx.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.emailVerification.deleteMany({
            where: { userId, id: { not: record.id } },
          });
        },
      );
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BusinessException(
          ErrorCode.EMAIL_ALREADY_REGISTERED,
          '该邮箱已被其他用户使用',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    this.emailService.sendEmailChanged(normalized).catch((err) => {
      this.logger.error('邮箱变更通知发送失败', err);
    });

    return { message: '邮箱已成功更换' };
  }

  async logout(userId: string, rawRefreshToken: string) {
    return this.sessions.logout(userId, rawRefreshToken);
  }

  async listSessions(userId: string, currentSessionId?: string, currentRefreshToken?: string) {
    return this.sessions.listSessions(userId, currentSessionId, currentRefreshToken);
  }

  async revokeSession(userId: string, sessionId: string) {
    return this.sessions.revokeSession(userId, sessionId);
  }
}
