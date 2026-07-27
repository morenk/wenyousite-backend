import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
/** 认证服务：负责注册、登录、Token 刷新 */
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  /** 注册新用户：检查邮箱和用户名唯一性，Argon2 哈希密码，签发双 Token */
  async register(dto: RegisterDto) {
    // 检查邮箱是否已被注册
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('该邮箱已被注册');
    }

    // 检查用户名是否已被占用
    const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existingUsername) {
      throw new ConflictException('该用户名已被占用');
    }

    // 使用 Argon2 哈希密码，配置参数从环境变量读取
    const password = await argon2.hash(dto.password, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });

    // 创建用户记录，默认使用用户名作为昵称
    const user = await this.prisma.user.create({
      data: { email: dto.email, username: dto.username, password, nickname: dto.username },
      select: { id: true, email: true, username: true, nickname: true, avatar: true, role: true },
    });

    const tokens = await this.generateTokens(user.id);

    // 生成 6 位数字验证码
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.prisma.emailVerification.create({
      data: { userId: user.id, token: code, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    this.emailService.sendVerification(user.email, code).catch(() => {});

    return { ...tokens, user };
  }

  /** 登录：验证邮箱和密码，签发双 Token */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
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

    const tokens = await this.generateTokens(user.id);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        role: user.role,
      },
    };
  }

  /** 刷新 Token：验证 refreshToken 有效性，签发新双 Token */
  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret')!,
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, username: true, nickname: true, avatar: true, role: true, deletedAt: true },
      });
      if (!user) throw new UnauthorizedException();
      if (user.deletedAt) throw new UnauthorizedException('账号已注销');

      const tokens = await this.generateTokens(user.id);
      return { ...tokens, user };
    } catch {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }
  }

  /** 生成 accessToken（15分钟）和 refreshToken（7天） */
  private async generateTokens(userId: string) {
    const payload = { sub: userId };

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
    const record = await this.prisma.emailVerification.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
    });
    if (!record) throw new UnauthorizedException('验证链接无效或已过期');

    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true },
    });
    await this.prisma.emailVerification.delete({ where: { id: record.id } });
    return { message: '邮箱验证成功' };
  }

  /** 修改密码 */
  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const valid = await argon2.verify(user.password, oldPassword);
    if (!valid) throw new UnauthorizedException('原密码错误');

    const hashed = await argon2.hash(newPassword, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    return { message: '密码已修改' };
  }

  /** 忘记密码 — 发送重置邮件 */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { message: '如果该邮箱已注册，重置邮件已发送' };

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.prisma.emailVerification.create({
      data: { userId: user.id, token: code, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    this.emailService.sendPasswordReset(email, code).catch(() => {});
    return { message: '如果该邮箱已注册，重置邮件已发送' };
  }

  /** 重置密码 */
  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.emailVerification.findFirst({
      where: { token, expiresAt: { gt: new Date() } },
    });
    if (!record) throw new UnauthorizedException('重置链接无效或已过期');

    const hashed = await argon2.hash(newPassword, {
      timeCost: this.configService.get<number>('argon2.timeCost')!,
      memoryCost: this.configService.get<number>('argon2.memoryCost')!,
    });
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { password: hashed, emailVerified: true },
    });
    await this.prisma.emailVerification.delete({ where: { id: record.id } });
    return { message: '密码已重置，请重新登录' };
  }
}

