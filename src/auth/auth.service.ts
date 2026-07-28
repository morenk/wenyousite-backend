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
import { LoginDto } from './dto/login.dto';
import { VerifyAndCompleteDto } from './dto/verify-and-complete.dto';

const userSelectPublic = {
  id: true, email: true, username: true, nickname: true, avatar: true,
  role: true, emailVerified: true,
} as const;

@Injectable()
/** 认证服务：注册、登录、Token 刷新、邮箱验证、密码管理、多设备会话 */
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  private readonly CODE_TTL = 15 * 60 * 1000; // 验证码统一有效期 15 分钟

  /** 注册第一步：请求邮箱验证码 */
  async requestCode(rawEmail: string) {
    const email = rawEmail.toLowerCase().trim();
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('该邮箱已被注册');
    }

    const now = new Date();
    const record = await this.prisma.emailVerification.findFirst({
      where: { email, type: 'REGISTRATION' },
    });

    if (record && record.expiresAt > now) {
      const remaining = Math.floor((record.expiresAt.getTime() - now.getTime()) / 1000);
      return { emailSent: true, codeExpiresIn: remaining, message: '验证码已发送，请查收邮箱' };
    }

    if (record) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
    }

    const code = this.generateCode();
    await this.prisma.emailVerification.create({
      data: {
        email,
        token: code,
        type: 'REGISTRATION',
        expiresAt: new Date(now.getTime() + this.CODE_TTL),
      },
    });

    let emailSent = true;
    try {
      await this.emailService.sendVerification(email, code);
    } catch (err) {
      this.logger.error(`注册验证邮件发送失败: ${email}`, err);
      emailSent = false;
    }

    return { emailSent, codeExpiresIn: this.CODE_TTL / 1000 };
  }

  /** 注册第二步：验证邮箱验证码 + 设置用户名密码，一步完成注册 */
  async verifyAndComplete(dto: VerifyAndCompleteDto) {
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
        data: { email, username: dto.username, password, nickname: dto.username, emailVerified: false },
        select: userSelectPublic,
      });

      await this.prisma.emailVerification.delete({ where: { id: record.id } });

      const { accessToken, refreshToken } = await this.createSession(user.id, null);
      return { accessToken, refreshToken, user };
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

  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /** 创建会话：生成 accessToken + refreshToken，写入 RefreshToken 记录 */
  private async createSession(userId: string, deviceInfo: string | null) {
    const accessToken = await this.jwtService.signAsync(
      { sub: userId },
      { secret: this.configService.get<string>('jwt.accessSecret')!, expiresIn: '15m' as const },
    );

    const rawRefreshToken = crypto.randomUUID();
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const family = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, family, deviceInfo, expiresAt },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /** 登录：验证邮箱和密码，创建新会话 */
  async login(dto: LoginDto, deviceInfo?: string) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { ...userSelectPublic, password: true, deletedAt: true },
    });
    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    if (user.deletedAt) {
      throw new UnauthorizedException('该账号已注销');
    }

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const { accessToken, refreshToken } = await this.createSession(
      user.id,
      deviceInfo ?? null,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    };
  }

  /** 刷新 Token：refresh token 轮转 + 盗用检测 */
  async refresh(rawRefreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const record = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: {
        user: { select: { ...userSelectPublic, deletedAt: true } },
      },
    });

    if (!record) {
      throw new UnauthorizedException('刷新令牌无效');
    }

    if (record.revokedAt) {
      // 盗用检测：已撤销的 token 被重复使用 → 整个 family 吊销
      await this.prisma.refreshToken.updateMany({
        where: { family: record.family },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('令牌已失效，请重新登录');
    }

    if (record.expiresAt <= new Date()) {
      throw new UnauthorizedException('刷新令牌已过期，请重新登录');
    }

    if (record.user.deletedAt) {
      throw new UnauthorizedException('账号已注销');
    }

    // 轮转：撤销旧 token，签发新 token
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    const newRawToken = crypto.randomUUID();
    const newHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: record.userId,
        tokenHash: newHash,
        family: record.family,
        deviceInfo: record.deviceInfo,
        expiresAt,
      },
    });

    const accessToken = await this.jwtService.signAsync(
      { sub: record.userId },
      { secret: this.configService.get<string>('jwt.accessSecret')!, expiresIn: '15m' as const },
    );

    return {
      accessToken,
      refreshToken: newRawToken,
      user: record.user,
    };
  }

  /** 验证邮箱 */
  async verifyEmail(token: string) {
    const anyRecord = await this.prisma.emailVerification.findFirst({
      where: { token, type: 'EMAIL_VERIFY' },
    });
    if (!anyRecord) throw new UnauthorizedException('验证码错误');
    if (anyRecord.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }
    if (anyRecord.attempts >= 5) {
      await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
      throw new UnauthorizedException('验证码尝试次数过多，请重新获取');
    }

    await this.prisma.user.update({
      where: { id: anyRecord.userId! },
      data: { emailVerified: true },
    });
    await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
    return { message: '邮箱验证成功' };
  }

  /** 修改密码：旧密码校验 + 吊销全部会话 */
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
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

    return { message: '密码已修改，请重新登录' };
  }

  /** 忘记密码 — 发送重置邮件 */
  async forgotPassword(rawEmail: string) {
    const email = rawEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { message: '如果该邮箱已注册，重置邮件已发送' };

    const existing = await this.prisma.emailVerification.findFirst({
      where: { userId: user.id, type: 'PASSWORD_RESET', expiresAt: { gt: new Date() } },
    });
    if (existing) {
      let emailSent = true;
      try {
        await this.emailService.sendPasswordReset(email, existing.token);
      } catch (err) {
        this.logger.error(`重置密码邮件发送失败: ${email}`, err);
        emailSent = false;
      }
      return { emailSent, message: '如果该邮箱已注册，重置邮件已发送' };
    }

    await this.prisma.emailVerification.deleteMany({
      where: { userId: user.id, type: 'PASSWORD_RESET' },
    });

    const code = this.generateCode();
    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        token: code,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + this.CODE_TTL),
      },
    });

    let emailSent = true;
    try {
      await this.emailService.sendPasswordReset(email, code);
    } catch (err) {
      this.logger.error(`重置密码邮件发送失败: ${email}`, err);
      emailSent = false;
    }
    return { emailSent, message: '如果该邮箱已注册，重置邮件已发送' };
  }

  /** 重置密码 + 吊销全部会话 */
  async resetPassword(token: string, newPassword: string) {
    const anyRecord = await this.prisma.emailVerification.findFirst({
      where: { token, type: 'PASSWORD_RESET' },
    });
    if (!anyRecord) throw new UnauthorizedException('验证码错误');
    if (anyRecord.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }
    if (anyRecord.attempts >= 5) {
      await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
      throw new UnauthorizedException('验证码尝试次数过多，请重新获取');
    }

    const userId = anyRecord.userId!;
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
      this.prisma.emailVerification.delete({ where: { id: anyRecord.id } }),
    ]);

    return { message: '密码已重置，请重新登录' };
  }

  /** 重发验证邮件 */
  async resendVerification(rawEmail: string) {
    const email = rawEmail.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { emailSent: true, message: '如果该邮箱已注册且未验证，验证邮件已发送' };
    }
    if (user.emailVerified) {
      return { emailSent: true, message: '如果该邮箱已注册且未验证，验证邮件已发送' };
    }

    const existing = await this.prisma.emailVerification.findFirst({
      where: { userId: user.id, type: 'EMAIL_VERIFY', expiresAt: { gt: new Date() } },
    });
    if (existing) {
      let emailSent = true;
      try {
        await this.emailService.sendVerification(user.email, existing.token);
      } catch (err) {
        this.logger.error(`重发验证邮件失败: ${email}`, err);
        emailSent = false;
      }
      return { emailSent, message: '如果该邮箱已注册且未验证，验证邮件已发送' };
    }

    await this.prisma.emailVerification.deleteMany({
      where: { userId: user.id, type: 'EMAIL_VERIFY' },
    });

    const code = this.generateCode();
    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        token: code,
        type: 'EMAIL_VERIFY',
        expiresAt: new Date(Date.now() + this.CODE_TTL),
      },
    });

    let emailSent = true;
    try {
      await this.emailService.sendVerification(user.email, code);
    } catch (err) {
      this.logger.error(`重发验证邮件失败: ${email}`, err);
      emailSent = false;
    }
    return { emailSent, message: '如果该邮箱已注册且未验证，验证邮件已发送' };
  }

  /** 登出：撤销指定设备的 refresh token */
  async logout(userId: string, rawRefreshToken: string) {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: '已登出' };
  }
}
