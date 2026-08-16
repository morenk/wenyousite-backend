/** 邮箱验证码服务：统一生成、复用、限频投递和作废注册/换绑/重置验证码记录。 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type VerificationCodeType = 'REGISTRATION' | 'CHANGE_EMAIL' | 'PASSWORD_RESET';

export const VERIFICATION_CODE_TTL = 15 * 60 * 1000; // 验证码统一有效期 15 分钟
export const VERIFICATION_SEND_COOLDOWN = 60 * 1000;

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

export interface PreparedVerificationIssue {
  id: string;
  code: string;
  resent: boolean;
  shouldSend: boolean;
  emailSent: boolean;
  sendAttemptAt: Date;
}

/** 邮箱验证码服务：生成 / 复用 / 限频投递 / 作废验证码记录 */
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
   * - 命中未过期记录 → 复用同一验证码，每 60 秒最多抢占一次发送窗口
   * - 否则 → 作废旧记录 → 生成新验证码 → 建记录 → 发送
   * 发送失败不抛错，并保留发送占位 60 秒，避免结果不明时被立即重试放大。
   */
  async issue(opts: IssueOptions): Promise<{ code: string; resent: boolean; emailSent: boolean }> {
    const prepared = await this.prepare(opts, this.prisma, true);
    const emailSent = await this.deliverPrepared(opts.label, prepared, () =>
      opts.send(prepared.code),
    );
    return { code: prepared.code, resent: prepared.resent, emailSent };
  }

  /** 在调用方交互事务内只准备记录；邮件必须等事务提交后再发送。 */
  prepareInTransaction(opts: PrepareIssueOptions, tx: Prisma.TransactionClient) {
    return this.prepare(opts, tx, false);
  }

  /** 提交后发送已准备好的验证码；冷却期内只复用上次投递结果。 */
  async deliverPrepared(
    label: string,
    prepared: PreparedVerificationIssue,
    run: () => Promise<void>,
  ): Promise<boolean> {
    if (!prepared.shouldSend) {
      this.logger.log(`${label}在发送冷却期内跳过重复投递`);
      return prepared.emailSent;
    }

    const emailSent = await this.sendSafely(label, run);
    if (emailSent) {
      await this.markDelivered(prepared);
    }
    return emailSent;
  }

  private async prepare(
    opts: PrepareIssueOptions,
    client: PrismaService | Prisma.TransactionClient,
    recoverUniqueConflict: boolean,
  ): Promise<PreparedVerificationIssue> {
    const { type, userId, email, resendIfSameEmail = false } = opts;
    const now = new Date();

    const record = await client.emailVerification.findFirst({
      where: { ...(userId ? { userId, type } : { email, type }) },
    });

    if (record && record.expiresAt > now && (!resendIfSameEmail || record.email === email)) {
      return this.claimExisting(record, client, now);
    }

    if (record) {
      // deleteMany 让两个并发的过期记录刷新都能继续进入“创建或复用”分支。
      await client.emailVerification.deleteMany({ where: { id: record.id } });
    }

    const code = this.generateCode();
    try {
      const created = await client.emailVerification.create({
        data: {
          ...(userId ? { userId } : {}),
          ...(email ? { email } : {}),
          token: code,
          type,
          expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL),
          lastSendAttemptAt: now,
        },
      });
      return {
        id: created.id,
        code,
        resent: false,
        shouldSend: true,
        emailSent: false,
        sendAttemptAt: now,
      };
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
          return this.claimExisting(existing, client, now);
        }
      }
      throw e;
    }
  }

  /** 原子抢占发送窗口；并发请求中只有 updateMany 成功的一方可以调用 SMTP。 */
  private async claimExisting(
    record: {
      id: string;
      token: string;
      lastSendAttemptAt: Date | null;
      lastSentAt: Date | null;
    },
    client: PrismaService | Prisma.TransactionClient,
    now: Date,
  ): Promise<PreparedVerificationIssue> {
    const cutoff = new Date(now.getTime() - VERIFICATION_SEND_COOLDOWN);
    const claimed = await client.emailVerification.updateMany({
      where: {
        id: record.id,
        OR: [{ lastSendAttemptAt: null }, { lastSendAttemptAt: { lte: cutoff } }],
      },
      data: { lastSendAttemptAt: now },
    });

    if (claimed.count > 0) {
      return {
        id: record.id,
        code: record.token,
        resent: true,
        shouldSend: true,
        emailSent: false,
        sendAttemptAt: now,
      };
    }

    const latest = await client.emailVerification.findUnique({
      where: { id: record.id },
      select: {
        id: true,
        token: true,
        lastSendAttemptAt: true,
        lastSentAt: true,
      },
    });
    if (!latest?.lastSendAttemptAt) {
      throw new Error('验证码发送占位记录在并发更新后消失');
    }

    return {
      id: latest.id,
      code: latest.token,
      resent: true,
      shouldSend: false,
      emailSent: latest.lastSentAt?.getTime() === latest.lastSendAttemptAt.getTime(),
      sendAttemptAt: latest.lastSendAttemptAt,
    };
  }

  /** SMTP 已确认成功后补记结果；失败不能反向触发客户端重发。 */
  private async markDelivered(prepared: PreparedVerificationIssue): Promise<void> {
    try {
      await this.prisma.emailVerification.updateMany({
        where: {
          id: prepared.id,
          lastSendAttemptAt: prepared.sendAttemptAt,
        },
        data: { lastSentAt: prepared.sendAttemptAt },
      });
    } catch {
      // 发送占位仍会保留并抑制重复邮件，状态补记失败只影响 emailSent 提示。
      this.logger.error('验证码邮件投递状态更新失败');
    }
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
