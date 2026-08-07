import {
  Injectable,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
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
  id: true, email: true, username: true, avatar: true,
  role: true, emailVerified: true,
} as const;

@Injectable()
/** 认证服务：注册、登录、Token 刷新、邮箱验证、密码管理、双端登录终端 */
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailService: EmailService,
    private verificationCodeService: VerificationCodeService,
    private sessions: AuthSessionService,
  ) {}

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

    return { emailSent, codeExpiresIn: VERIFICATION_CODE_TTL / 1000, message: '验证码已发送，请查收邮箱' };
  }

  /** 注册第二步：验证邮箱验证码 + 设置用户名密码，一步完成注册 */
  async verifyAndComplete(dto: VerifyAndCompleteDto, deviceInfo?: string, platform: ClientPlatform = 'web') {
    const email = dto.email.toLowerCase().trim();
    const record = await this.prisma.emailVerification.findFirst({
      where: { email, type: 'REGISTRATION' },
    });
    if (!record) {
      throw unauthorized('请先获取邮箱验证码', ErrorCode.NO_CODE_RECORD);
    }

    if (record.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
      throw unauthorized('验证码已过期，请重新获取', ErrorCode.CODE_EXPIRED);
    }

    if (record.token !== dto.code) {
      if (record.attempts >= 5) {
        await this.prisma.emailVerification.delete({ where: { id: record.id } });
        throw unauthorized('验证码尝试次数过多，请重新获取', ErrorCode.CODE_ATTEMPTS_EXCEEDED);
      }
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw unauthorized('验证码错误', ErrorCode.CODE_INVALID);
    }

    const password = await argon2.hash(dto.password, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });

    try {
      const user = await this.prisma.user.create({
        data: { email, username: dto.username, password, emailVerified: true },
        select: userSelectPublic,
      });

      await this.prisma.emailVerification.delete({ where: { id: record.id } });

      const { accessToken, refreshToken } = await this.sessions.createSession(user.id, deviceInfo ?? null, platform);
      return { accessToken, refreshToken, user, message: '注册成功' };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = (e.meta as Record<string, unknown> | null)?.target as string[] | undefined;
        if (target?.includes('username')) {
          throw new BusinessException(
            ErrorCode.USERNAME_TAKEN,
            '该用户名已被占用',
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

  /** 验证邮箱（需登录，按 userId + type 查询避免 token 碰撞） */
  async verifyEmail(userId: string, inputToken: string) {
    const record = await this.prisma.emailVerification.findFirst({
      where: { userId, type: 'EMAIL_VERIFY' },
    });
    if (!record) throw unauthorized('请先请求验证码', ErrorCode.NO_CODE_RECORD);
    if (record.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
      throw unauthorized('验证码已过期，请重新获取', ErrorCode.CODE_EXPIRED);
    }

    if (record.token !== inputToken) {
      if (record.attempts >= 5) {
        await this.prisma.emailVerification.delete({ where: { id: record.id } });
        throw unauthorized('验证码尝试次数过多，请重新获取', ErrorCode.CODE_ATTEMPTS_EXCEEDED);
      }
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw unauthorized('验证码错误', ErrorCode.CODE_INVALID);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });
    await this.prisma.emailVerification.delete({ where: { id: record.id } });
    return { message: '邮箱验证成功' };
  }

  /** 修改密码：旧密码校验 + 吊销全部会话 + 发送通知邮件 */
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, email: true },
    });
    if (!user) throw unauthorized('登录状态无效', ErrorCode.UNAUTHORIZED);

    if (oldPassword === newPassword) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '新密码不能与旧密码相同');
    }

    const valid = await argon2.verify(user.password, oldPassword);
    if (!valid) throw unauthorized('原密码错误', ErrorCode.WRONG_OLD_PASSWORD);

    const hashed = await argon2.hash(newPassword, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashed },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.emailService.sendPasswordChanged(user.email).catch((err) => {
      this.logger.error(`密码修改通知邮件发送失败: ${user.email}`, err);
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
    const record = await this.prisma.emailVerification.findFirst({
      where: { email, type: 'PASSWORD_RESET' },
    });
    if (!record) throw unauthorized('验证码错误', ErrorCode.CODE_INVALID);
    if (record.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
      throw unauthorized('验证码已过期，请重新获取', ErrorCode.CODE_EXPIRED);
    }

    if (record.token !== inputToken) {
      if (record.attempts >= 5) {
        await this.prisma.emailVerification.delete({ where: { id: record.id } });
        throw unauthorized('验证码尝试次数过多，请重新获取', ErrorCode.CODE_ATTEMPTS_EXCEEDED);
      }
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw unauthorized('验证码错误', ErrorCode.CODE_INVALID);
    }

    const userId = record.userId!;
    const hashed = await argon2.hash(newPassword, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashed, emailVerified: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.emailVerification.delete({ where: { id: record.id } }),
    ]);

    return { message: '密码已重置，请重新登录' };
  }

  /** 更换邮箱第一步：向新邮箱发送 6 位验证码 */
  async requestChangeEmailCode(userId: string, newEmail: string, oldPassword: string) {
    const normalized = newEmail.toLowerCase().trim();
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, password: true },
    });
    if (!currentUser) throw unauthorized('登录状态无效', ErrorCode.UNAUTHORIZED);
    if (currentUser.email === normalized) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '新邮箱不能与当前邮箱相同');
    }

    // 二次认证：校验当前密码，防止会话被劫持后直接改邮箱
    const valid = await argon2.verify(currentUser.password, oldPassword);
    if (!valid) throw unauthorized('当前密码错误', ErrorCode.WRONG_OLD_PASSWORD);

    const existing = await this.prisma.user.findUnique({
      where: { email: normalized, deletedAt: null },
    });
    if (existing) {
      throw new BusinessException(
        ErrorCode.EMAIL_ALREADY_REGISTERED,
        '该邮箱已被其他用户使用',
        HttpStatus.CONFLICT,
      );
    }

    await this.verificationCodeService.issue({
      type: 'CHANGE_EMAIL',
      userId,
      email: normalized,
      resendIfSameEmail: true,
      label: '更换邮箱验证码',
      send: (code) => this.emailService.sendVerification(normalized, code, 'CHANGE_EMAIL'),
    });

    return { message: '验证码已发送，请查收新邮箱' };
  }

  /** 更换邮箱第二步：验证码确认后更新 email */
  async verifyChangeEmail(userId: string, newEmail: string, inputCode: string) {
    const normalized = newEmail.toLowerCase().trim();
    const record = await this.prisma.emailVerification.findFirst({
      where: { userId, type: 'CHANGE_EMAIL', email: normalized },
    });
    if (!record) throw unauthorized('请先请求验证码', ErrorCode.NO_CODE_RECORD);
    if (record.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
      throw unauthorized('验证码已过期，请重新获取', ErrorCode.CODE_EXPIRED);
    }
    if (record.token !== inputCode) {
      if (record.attempts >= 5) {
        await this.prisma.emailVerification.delete({ where: { id: record.id } });
        throw unauthorized('验证码尝试次数过多，请重新获取', ErrorCode.CODE_ATTEMPTS_EXCEEDED);
      }
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw unauthorized('验证码错误', ErrorCode.CODE_INVALID);
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: normalized, deletedAt: null },
    });
    if (existing) {
      throw new BusinessException(
        ErrorCode.EMAIL_ALREADY_REGISTERED,
        '该邮箱已被其他用户使用',
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { email: normalized, emailVerified: true },
      }),
      this.prisma.emailVerification.delete({ where: { id: record.id } }),
    ]);

    this.emailService.sendEmailChanged(normalized).catch((err) => {
      this.logger.error(`邮箱变更通知发送失败: ${normalized}`, err);
    });

    return { message: '邮箱已成功更换' };
  }

  /** 重发验证邮件 */
  async resendVerification(rawEmail: string) {
    const email = rawEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
    });
    if (!user || user.emailVerified) {
      return { emailSent: true, message: '如果该邮箱已注册且未验证，验证邮件已发送' };
    }

    const { emailSent } = await this.verificationCodeService.issue({
      type: 'EMAIL_VERIFY',
      userId: user.id,
      email,
      label: '重发验证邮件',
      send: (code) => this.emailService.sendVerification(user.email, code, 'EMAIL_VERIFY'),
    });

    return { emailSent, message: '如果该邮箱已注册且未验证，验证邮件已发送' };
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
