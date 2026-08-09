/** 邮箱验证码服务：统一"生成 / 复用 / 重发 / 作废"验证码记录，供注册、验证邮箱、换邮箱、重置密码复用 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type VerificationCodeType =
  'REGISTRATION' | 'EMAIL_VERIFY' | 'CHANGE_EMAIL' | 'PASSWORD_RESET';

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

type PrepareIssueOptions = Omit<IssueOptions, 'label' | 'send'>;

/** 邮箱验证码服务：生成 / 复用 / 重发 / 作废验证码记录 */
@Injectable()
export class VerificationCodeService {
  private readonly logger = new Logger(VerificationCodeService.name);

  constructor(private prisma: PrismaService) {}

  /** 生成 6 位数字验证码 */
  generateCode(): string {
    return String(randomInt(100000, 1_000_000));
  }

  /**
   * 统一发码/重发：
   * - 命中未过期记录 → 按 resendIfSameEmail 判断是否复用并重发同一验证码
   * - 否则 → 作废旧记录 → 生成新验证码 → 建记录 → 发送
   * 发送失败不抛错，由 emailSent 标记，调用方决定日志/提示。
   */
  async issue(opts: IssueOptions): Promise<{ code: string; resent: boolean; emailSent: boolean }> {
    const prepared = await this.prepare(opts, this.prisma, true);
    const emailSent = await this.deliver(opts.label, () => opts.send(prepared.code));
    return { ...prepared, emailSent };
  }

  /** 在调用方交互事务内只准备记录；邮件必须等事务提交后再发送。 */
  prepareInTransaction(opts: PrepareIssueOptions, tx: Prisma.TransactionClient) {
    return this.prepare(opts, tx, false);
  }

  /** 提交后发送已准备好的验证码，失败只记脱敏日志。 */
  deliver(label: string, run: () => Promise<void>) {
    return this.sendSafely(label, run);
  }

  private async prepare(
    opts: PrepareIssueOptions,
    client: PrismaService | Prisma.TransactionClient,
    recoverUniqueConflict: boolean,
  ): Promise<{ code: string; resent: boolean }> {
    const { type, userId, email, resendIfSameEmail = false } = opts;
    const now = new Date();

    const record = await client.emailVerification.findFirst({
      where: { ...(userId ? { userId, type } : { email, type }) },
    });

    if (record && record.expiresAt > now && (!resendIfSameEmail || record.email === email)) {
      return { code: record.token, resent: true };
    }

    if (record) {
      // deleteMany 让两个并发的过期记录刷新都能继续进入“创建或复用”分支。
      await client.emailVerification.deleteMany({ where: { id: record.id } });
    }

    const code = this.generateCode();
    try {
      await client.emailVerification.create({
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
        // PostgreSQL 中语句错误会使交互事务进入 aborted 状态；事务调用交给
        // 外层整体映射，只有独立调用才能安全回查并复用抢先创建的记录。
        if (!recoverUniqueConflict) throw e;
        const existing = await client.emailVerification.findFirst({
          where: { ...(userId ? { userId, type } : { email, type }) },
        });
        if (existing) {
          return { code: existing.token, resent: true };
        }
      }
      throw e;
    }

    return { code, resent: false };
  }

  /** 发送并吞掉异常，返回是否发送成功 */
  private async sendSafely(label: string, run: () => Promise<void>): Promise<boolean> {
    try {
      await run();
      return true;
    } catch {
      this.logger.error(`${label}发送失败`);
      return false;
    }
  }
}
