/** 邮箱验证码服务：统一"生成 / 复用 / 重发 / 作废"验证码记录，供注册、验证邮箱、换邮箱、重置密码复用 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type VerificationCodeType =
  | 'REGISTRATION'
  | 'EMAIL_VERIFY'
  | 'CHANGE_EMAIL'
  | 'PASSWORD_RESET';

export const VERIFICATION_CODE_TTL = 15 * 60 * 1000; // 验证码统一有效期 15 分钟

interface IssueOptions {
  type: VerificationCodeType;
  /** REGISTRATION 以 email 为查找键；其余以 userId 为查找键 */
  userId?: string;
  email?: string;
  /** true 时仅当旧记录 email 与本次目标一致才复用（换邮箱用）；否则只要未过期即复用 */
  resendIfSameEmail?: boolean;
  /** 日志前缀，如 '注册验证邮件' */
  label: string;
  send: (code: string) => Promise<void>;
}

/** 邮箱验证码服务：生成 / 复用 / 重发 / 作废验证码记录 */
@Injectable()
export class VerificationCodeService {
  private readonly logger = new Logger(VerificationCodeService.name);

  constructor(private prisma: PrismaService) {}

  /** 生成 6 位数字验证码 */
  generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /**
   * 统一发码/重发：
   * - 命中未过期记录 → 按 resendIfSameEmail 判断是否复用并重发同一验证码
   * - 否则 → 作废旧记录 → 生成新验证码 → 建记录 → 发送
   * 发送失败不抛错，由 emailSent 标记，调用方决定日志/提示。
   */
  async issue(opts: IssueOptions): Promise<{ code: string; resent: boolean; emailSent: boolean }> {
    const { type, userId, email, resendIfSameEmail = false, label, send } = opts;
    const now = new Date();

    const record = await this.prisma.emailVerification.findFirst({
      where: { ...(userId ? { userId, type } : { email, type }) },
    });

    if (record && record.expiresAt > now && (!resendIfSameEmail || record.email === email)) {
      const emailSent = await this.sendSafely(label, email ?? userId ?? '', () => send(record.token));
      return { code: record.token, resent: true, emailSent };
    }

    if (record) {
      await this.prisma.emailVerification.delete({ where: { id: record.id } });
    }

    const code = this.generateCode();
    try {
      await this.prisma.emailVerification.create({
        data: {
          ...(userId ? { userId } : {}),
          ...(email ? { email } : {}),
          token: code,
          type,
          expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL),
        },
      });
    } catch (e) {
      // 并发请求已抢先创建记录，复用其验证码
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.emailVerification.findFirst({
          where: { ...(userId ? { userId, type } : { email, type }) },
        });
        if (existing) {
          const emailSent = await this.sendSafely(label, email ?? userId ?? '', () => send(existing.token));
          return { code: existing.token, resent: true, emailSent };
        }
      }
      throw e;
    }

    const emailSent = await this.sendSafely(label, email ?? userId ?? '', () => send(code));
    return { code, resent: false, emailSent };
  }

  /** 发送并吞掉异常，返回是否发送成功 */
  private async sendSafely(label: string, target: string, run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`${label}发送失败: ${target} | ${message}`);
      return false;
    }
  }
}
