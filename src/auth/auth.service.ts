import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { VerificationCodeService, VERIFICATION_CODE_TTL } from './verification-code.service';
import { LoginDto } from './dto/login.dto';
import { VerifyAndCompleteDto } from './dto/verify-and-complete.dto';
import { ClientPlatform, normalizeClientPlatform } from './client-platform';

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
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private verificationCodeService: VerificationCodeService,
  ) {}

  private readonly REFRESH_WEB_TTL = 7 * 24 * 60 * 60 * 1000; // Web 端 7 天
  private readonly REFRESH_MOBILE_TTL = 30 * 24 * 60 * 60 * 1000; // 移动端 30 天
  private readonly REFRESH_REPLAY_GRACE = 10 * 1000;

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** 注册第一步：请求邮箱验证码 */
  async requestCode(rawEmail: string) {
    const email = rawEmail.toLowerCase().trim();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('该邮箱已被注册');
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
      throw new BadRequestException('请先获取邮箱验证码');
    }

    if (record.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }

    if (record.token !== dto.code) {
      if (record.attempts >= 5) {
        await this.prisma.emailVerification.delete({ where: { id: record.id } });
        throw new UnauthorizedException('验证码尝试次数过多，请重新获取');
      }
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('验证码错误');
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

      const { accessToken, refreshToken } = await this.createSession(user.id, deviceInfo ?? null, platform);
      return { accessToken, refreshToken, user, message: '注册成功' };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const target = (e.meta as Record<string, unknown> | null)?.target as string[] | undefined;
        if (target?.includes('username')) {
          throw new ConflictException('该用户名已被占用');
        }
      }
      throw e;
    }
  }

  /** 创建登录终端：同一用户同一平台只保留最新终端。用户行锁保证并发登录不会产生重复槽位。 */
  private async createSession(userId: string, deviceInfo: string | null, platform: ClientPlatform = 'web') {
    const normalizedPlatform = normalizeClientPlatform(platform);
    const family = crypto.randomUUID();
    const sessionStartedAt = new Date();
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, sid: family },
      { secret: this.configService.get<string>('jwt.accessSecret')!, expiresIn: '15m' as const },
    );

    const rawRefreshToken = crypto.randomUUID();
    const tokenHash = this.hashToken(rawRefreshToken);
    const ttl = normalizedPlatform === 'mobile' ? this.REFRESH_MOBILE_TTL : this.REFRESH_WEB_TTL;
    const expiresAt = new Date(Date.now() + ttl);

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx.refreshToken.updateMany({
        where: { userId, platform: normalizedPlatform, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.create({
        data: {
          userId,
          tokenHash,
          family,
          platform: normalizedPlatform,
          deviceInfo,
          sessionStartedAt,
          expiresAt,
        },
      });
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /** 登录：验证邮箱或用户名 + 密码，创建新会话（含 5 次失败锁定） */
  async login(dto: LoginDto, deviceInfo?: string, platform: ClientPlatform = 'web') {
    const account = dto.account.trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          // 邮箱统一小写匹配；用户名大小写敏感精确匹配（与注册唯一约束一致）
          { email: account.toLowerCase() },
          { username: account },
        ],
      },
      select: { ...userSelectPublic, password: true, deletedAt: true, failedLoginAttempts: true, lockedUntil: true },
    });
    if (!user) {
      throw new UnauthorizedException('账号或密码错误');
    }

    if (user.deletedAt) {
      throw new UnauthorizedException('账号或密码错误');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('登录过于频繁，请稍后重试');
    }

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      if (attempts >= 5) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: attempts, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
        });
        throw new UnauthorizedException('登录过于频繁，请稍后重试');
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts },
      });
      throw new UnauthorizedException('账号或密码错误');
    }

    // 登录成功，重置失败计数
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const { accessToken, refreshToken } = await this.createSession(
      user.id,
      deviceInfo ?? null,
      platform,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    };
  }

  /** 刷新 Token：在用户行锁内轮转，和同平台新登录串行化。 */
  async refresh(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    const initial = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!initial) {
      throw new UnauthorizedException('刷新令牌无效');
    }

    const rotated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${initial.userId} FOR UPDATE`;
      const record = await tx.refreshToken.findFirst({
        where: { tokenHash },
        include: {
          user: { select: { ...userSelectPublic, deletedAt: true } },
        },
      });

      if (!record) {
        return { ok: false as const, message: '刷新令牌无效' };
      }

      if (record.revokedAt) {
        const outsideGrace = Date.now() - record.revokedAt.getTime() > this.REFRESH_REPLAY_GRACE;
        if (outsideGrace) {
          // 必须先提交吊销，再在事务外抛错；事务内抛错会回滚安全操作。
          await tx.refreshToken.updateMany({
            where: { userId: record.userId, family: record.family, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        return { ok: false as const, message: '令牌已失效，请重新登录' };
      }

      if (record.expiresAt <= new Date()) {
        await tx.refreshToken.updateMany({
          where: { id: record.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { ok: false as const, message: '刷新令牌已过期，请重新登录' };
      }

      if (record.user.deletedAt) {
        await tx.refreshToken.updateMany({
          where: { userId: record.userId, family: record.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { ok: false as const, message: '刷新令牌无效' };
      }

      // 原子撤销：用 updateMany({ id, revokedAt: null }) 防并发竞争
      const revokeResult = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (revokeResult.count === 0) {
        await tx.refreshToken.updateMany({
          where: { userId: record.userId, family: record.family, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { ok: false as const, message: '令牌已失效，请重新登录' };
      }

      const newRawToken = crypto.randomUUID();
      const newHash = this.hashToken(newRawToken);
      const platform = normalizeClientPlatform(record.platform);
      const ttl = platform === 'mobile' ? this.REFRESH_MOBILE_TTL : this.REFRESH_WEB_TTL;
      const expiresAt = new Date(Date.now() + ttl);

      await tx.refreshToken.create({
        data: {
          userId: record.userId,
          tokenHash: newHash,
          family: record.family,
          platform,
          deviceInfo: record.deviceInfo,
          sessionStartedAt: record.sessionStartedAt,
          expiresAt,
        },
      });

      return {
        ok: true as const,
        newRawToken,
        platform,
        sessionId: record.family,
        userId: record.userId,
        user: record.user,
      };
    });

    if (!rotated.ok) {
      throw new UnauthorizedException(rotated.message);
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: rotated.userId, sid: rotated.sessionId },
      { secret: this.configService.get<string>('jwt.accessSecret')!, expiresIn: '15m' as const },
    );

    return {
      accessToken,
      refreshToken: rotated.newRawToken,
      platform: rotated.platform,
      user: {
        id: rotated.user.id,
        email: rotated.user.email,
        username: rotated.user.username,
        avatar: rotated.user.avatar,
        role: rotated.user.role,
        emailVerified: rotated.user.emailVerified,
      },
    };
  }

  /** 验证邮箱（需登录，按 userId + type 查询避免 token 碰撞） */
  async verifyEmail(userId: string, inputToken: string) {
    const record = await this.prisma.emailVerification.findFirst({
      where: { userId, type: 'EMAIL_VERIFY' },
    });
    if (!record) throw new BadRequestException('请先请求验证码');
    if (record.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }

    if (record.token !== inputToken) {
      if (record.attempts >= 5) {
        await this.prisma.emailVerification.delete({ where: { id: record.id } });
        throw new UnauthorizedException('验证码尝试次数过多，请重新获取');
      }
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('验证码错误');
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
    if (!user) throw new UnauthorizedException();

    if (oldPassword === newPassword) {
      throw new BadRequestException('新密码不能与旧密码相同');
    }

    const valid = await argon2.verify(user.password, oldPassword);
    if (!valid) throw new UnauthorizedException('原密码错误');

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
    if (!record) throw new UnauthorizedException('验证码错误');
    if (record.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }

    if (record.token !== inputToken) {
      if (record.attempts >= 5) {
        await this.prisma.emailVerification.delete({ where: { id: record.id } });
        throw new UnauthorizedException('验证码尝试次数过多，请重新获取');
      }
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('验证码错误');
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
    if (!currentUser) throw new UnauthorizedException();
    if (currentUser.email === normalized) {
      throw new BadRequestException('新邮箱不能与当前邮箱相同');
    }

    // 二次认证：校验当前密码，防止会话被劫持后直接改邮箱
    const valid = await argon2.verify(currentUser.password, oldPassword);
    if (!valid) throw new UnauthorizedException('当前密码错误');

    const existing = await this.prisma.user.findUnique({
      where: { email: normalized, deletedAt: null },
    });
    if (existing) throw new ConflictException('该邮箱已被其他用户使用');

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
    if (!record) throw new BadRequestException('请先请求验证码');
    if (record.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }
    if (record.token !== inputCode) {
      if (record.attempts >= 5) {
        await this.prisma.emailVerification.delete({ where: { id: record.id } });
        throw new UnauthorizedException('验证码尝试次数过多，请重新获取');
      }
      await this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('验证码错误');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: normalized, deletedAt: null },
    });
    if (existing) throw new ConflictException('该邮箱已被其他用户使用');

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

  /** 登出：撤销当前登录终端的 refresh token */
  async logout(userId: string, rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: '已登出' };
  }

  /** 列出当前用户的 Web / 移动客户端活跃登录终端。 */
  async listSessions(userId: string, currentSessionId?: string, currentRefreshToken?: string) {
    const currentHash = currentRefreshToken ? this.hashToken(currentRefreshToken) : null;
    const now = new Date();
    const sessions = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      select: {
        family: true, platform: true, deviceInfo: true, sessionStartedAt: true,
        createdAt: true, expiresAt: true, tokenHash: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map(s => ({
      id: s.family,
      platform: normalizeClientPlatform(s.platform),
      deviceInfo: s.deviceInfo,
      isCurrent: s.family === currentSessionId || (currentHash !== null && s.tokenHash === currentHash),
      signedInAt: s.sessionStartedAt,
      lastActiveAt: s.createdAt,
      expiresAt: s.expiresAt,
      createdAt: s.sessionStartedAt,
    }));
  }

  /** 退出指定登录终端；兼容旧客户端传 refresh token 记录 ID。 */
  async revokeSession(userId: string, sessionId: string) {
    const terminal = await this.prisma.refreshToken.findFirst({
      where: {
        userId,
        OR: [{ family: sessionId }, { id: sessionId }],
      },
      select: { family: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!terminal) {
      throw new BadRequestException('登录终端不存在或已失效');
    }

    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, family: terminal.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException('登录终端不存在或已失效');
    }
    return { message: '登录终端已退出' };
  }
}
