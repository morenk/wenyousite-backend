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
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LoginDto } from './dto/login.dto';
import { VerifyAndCompleteDto } from './dto/verify-and-complete.dto';

@Injectable()
/** 认证服务：负责注册、登录、Token 刷新 */
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  private readonly CODE_TTL = 15 * 60 * 1000;   // 验证码有效期 15 分钟
  private readonly DRAFT_TTL = 60 * 60 * 1000;  // 注册草稿存活 1 小时

  /** 注册第一步：请求邮箱验证码 */
  async requestCode(email: string) {
    // 检查邮箱是否已被注册
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException('该邮箱已被注册');
    }

    const now = new Date();
    const draft = await this.prisma.registrationDraft.findUnique({ where: { email } });

    // 区间 3：无草稿 或 草稿超过 1 小时 → 新建
    if (!draft || draft.createdAt.getTime() + this.DRAFT_TTL <= now.getTime()) {
      if (draft) {
        await this.prisma.registrationDraft.delete({ where: { id: draft.id } });
      }
      const code = this.generateCode();
      await this.prisma.registrationDraft.create({
        data: { email, verificationCode: code, codeExpiresAt: new Date(now.getTime() + this.CODE_TTL) },
      });
      this.emailService.sendVerification(email, code).catch(err => {
        this.logger.error(`注册验证邮件发送失败: ${email}`, err);
      });
      return { sent: true, codeExpiresIn: this.CODE_TTL / 1000 };
    }

    const remaining = Math.floor((draft.codeExpiresAt.getTime() - now.getTime()) / 1000);

    // 区间 1：验证码未过期（< 15 分钟）→ 不重发
    if (remaining > 0) {
      return { sent: false, codeExpiresIn: remaining, message: '验证码已发送，请查收邮箱' };
    }

    // 区间 2：验证码已过期但草稿 < 1 小时 → 更新验证码并重发
    const code = this.generateCode();
    await this.prisma.registrationDraft.update({
      where: { id: draft.id },
      data: { verificationCode: code, codeExpiresAt: new Date(now.getTime() + this.CODE_TTL) },
    });
    this.emailService.sendVerification(email, code).catch(err => {
      this.logger.error(`注册验证邮件发送失败: ${email}`, err);
    });
    return { sent: true, codeExpiresIn: this.CODE_TTL / 1000 };
  }

  /** 注册第二步：验证邮箱验证码 + 设置用户名密码，一步完成注册 */
  async verifyAndComplete(dto: VerifyAndCompleteDto) {
    const draft = await this.prisma.registrationDraft.findUnique({ where: { email: dto.email } });
    if (!draft) {
      throw new BadRequestException('请先获取邮箱验证码');
    }

    // 校验验证码
    if (draft.verificationCode !== dto.code) {
      throw new UnauthorizedException('验证码错误');
    }
    if (draft.codeExpiresAt <= new Date()) {
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }

    // 草稿过期保护
    if (draft.createdAt.getTime() + this.DRAFT_TTL <= Date.now()) {
      await this.prisma.registrationDraft.delete({ where: { id: draft.id } });
      throw new BadRequestException('注册会话已过期，请重新获取验证码');
    }

    // 检查用户名唯一性
    const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existingUsername) {
      throw new ConflictException('该用户名已被占用');
    }

    // 创建用户（邮箱已验证）
    const password = await argon2.hash(dto.password, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });
    const user = await this.prisma.user.create({
      data: { email: dto.email, username: dto.username, password, nickname: dto.username, emailVerified: true },
      select: { id: true, email: true, username: true, nickname: true, avatar: true, role: true, emailVerified: true },
    });

    // 清理注册草稿
    await this.prisma.registrationDraft.delete({ where: { id: draft.id } });

    const tokens = await this.generateTokens(user.id, 0);
    return { ...tokens, user };
  }

  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /** 登录：验证邮箱和密码，签发双 Token */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, username: true, nickname: true, avatar: true, role: true, emailVerified: true, password: true, tokenVersion: true, deletedAt: true },
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

    const tokens = await this.generateTokens(user.id, user.tokenVersion);

    return {
      ...tokens,
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

  /** 刷新 Token：验证 refreshToken 有效性，签发新双 Token */
  async refresh(refreshToken: string) {
    let payload: { sub: string; tv: number };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret')!,
      });
    } catch {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, username: true, nickname: true, avatar: true, role: true, emailVerified: true, tokenVersion: true, deletedAt: true },
    });
    if (!user) throw new UnauthorizedException();
    if (user.deletedAt) throw new UnauthorizedException('账号已注销');

    // 验证 token 版本号，改密码/登出后旧 refresh token 失效
    if (payload.tv !== user.tokenVersion) {
      throw new UnauthorizedException('令牌已失效，请重新登录');
    }

    const tokens = await this.generateTokens(user.id, user.tokenVersion);
    return { ...tokens, user };
  }

  /** 生成 accessToken（15分钟）和 refreshToken（7天），内嵌 token 版本号 */
  private async generateTokens(userId: string, tokenVersion: number) {
    const payload = { sub: userId, tv: tokenVersion };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('jwt.accessSecret')!,
      expiresIn: '15m' as const,
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('jwt.refreshSecret')!,
      expiresIn: '7d' as const,
    });

    return { accessToken, refreshToken };
  }

  /** 验证邮箱 */
  async verifyEmail(token: string) {
    // 先查是否存在（不限过期），区分"码错误"和"已过期"
    const anyRecord = await this.prisma.emailVerification.findFirst({
      where: { token, type: 'EMAIL_VERIFY' },
    });
    if (!anyRecord) throw new UnauthorizedException('验证码错误');
    if (anyRecord.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }

    await this.prisma.user.update({
      where: { id: anyRecord.userId },
      data: { emailVerified: true },
    });
    await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
    return { message: '邮箱验证成功' };
  }

  /** 修改密码 */
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, tokenVersion: true },
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
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, tokenVersion: user.tokenVersion + 1 },
    });
    return { message: '密码已修改，请重新登录' };
  }

  /** 忘记密码 — 发送重置邮件 */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { message: '如果该邮箱已注册，重置邮件已发送' };

    // 若有未过期的重置记录，复用同一验证码重发
    const existing = await this.prisma.emailVerification.findFirst({
      where: { userId: user.id, type: 'PASSWORD_RESET', expiresAt: { gt: new Date() } },
    });
    if (existing) {
      this.emailService.sendPasswordReset(email, existing.token).catch(err => {
        this.logger.error(`重置密码邮件发送失败: ${email}`, err);
      });
      return { message: '如果该邮箱已注册，重置邮件已发送' };
    }

    // 删除该用户旧的过期重置记录
    await this.prisma.emailVerification.deleteMany({
      where: { userId: user.id, type: 'PASSWORD_RESET' },
    });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        token: code,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    this.emailService.sendPasswordReset(email, code).catch(err => {
      this.logger.error(`重置密码邮件发送失败: ${email}`, err);
    });
    return { message: '如果该邮箱已注册，重置邮件已发送' };
  }

  /** 重置密码 */
  async resetPassword(token: string, newPassword: string) {
    // 先查是否存在（不限过期），区分"码错误"和"已过期"
    const anyRecord = await this.prisma.emailVerification.findFirst({
      where: { token, type: 'PASSWORD_RESET' },
    });
    if (!anyRecord) throw new UnauthorizedException('验证码错误');
    if (anyRecord.expiresAt <= new Date()) {
      await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: anyRecord.userId },
      select: { tokenVersion: true },
    });
    if (!user) throw new UnauthorizedException();

    const hashed = await argon2.hash(newPassword, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });
    // 重置密码同时验证邮箱（能收邮件即证明邮箱所有权）
    await this.prisma.user.update({
      where: { id: anyRecord.userId },
      data: { password: hashed, emailVerified: true, tokenVersion: user.tokenVersion + 1 },
    });
    await this.prisma.emailVerification.delete({ where: { id: anyRecord.id } });
    return { message: '密码已重置，请重新登录' };
  }

  /** 重发验证邮件 */
  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { message: '如果该邮箱已注册且未验证，验证邮件已发送' };
    }
    if (user.emailVerified) {
      return { message: '如果该邮箱已注册且未验证，验证邮件已发送' };
    }

    // 若有未过期的验证记录，复用同一验证码重发
    const existing = await this.prisma.emailVerification.findFirst({
      where: { userId: user.id, type: 'EMAIL_VERIFY', expiresAt: { gt: new Date() } },
    });
    if (existing) {
      this.emailService.sendVerification(user.email, existing.token).catch(err => {
        this.logger.error(`重发验证邮件失败: ${email}`, err);
      });
      return { message: '如果该邮箱已注册且未验证，验证邮件已发送' };
    }

    // 删除该用户旧的过期验证记录
    await this.prisma.emailVerification.deleteMany({
      where: { userId: user.id, type: 'EMAIL_VERIFY' },
    });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        token: code,
        type: 'EMAIL_VERIFY',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    this.emailService.sendVerification(user.email, code).catch(err => {
      this.logger.error(`重发验证邮件失败: ${email}`, err);
    });
    return { message: '如果该邮箱已注册且未验证，验证邮件已发送' };
  }

  /** 登出：使所有已签发 token 立即失效 */
  async logout(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { message: '已登出' };
  }
}
