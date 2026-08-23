import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TipTargetType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { ThreadAccessService } from '../access/thread-access.service';
import { paginate } from '../common/dto/paginated-result';
import { BusinessException, forbidden, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { hashIdempotencyPayload } from '../common/idempotency';
import { publicUserSummarySelect } from '../common/user-summary';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { beijingDateKey, progressionFor } from '../progression/progression.constants';
import { ProgressionService } from '../progression/progression.service';
import { splitTipAmount } from './economy.constants';

const PLATFORM_WALLET_ID = 'wallet_platform';
const MAX_BIGINT = 9_223_372_036_854_775_807n;

function isRetryableTransactionConflict(error: unknown): boolean {
  const prismaError = error as { code?: string; meta?: { code?: string } };
  return (
    prismaError?.code === 'P2034' ||
    (prismaError?.code === 'P2010' && ['40001', '40P01'].includes(prismaError.meta?.code ?? ''))
  );
}

interface TipTarget {
  type: TipTargetType;
  id: string;
  recipientId: string;
  threadId?: string;
  threadTitle?: string | null;
  momentId?: string;
  momentTitle?: string;
}

interface PreparedTip {
  amount: bigint;
  requestHash: string;
  senderWallet: { id: string };
}

@Injectable()
export class EconomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threadAccess: ThreadAccessService,
    private readonly progression: ProgressionService,
    private readonly outbox: OutboxService,
  ) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true, receivedTipTotal: true, receivedTipCount: true },
    });
    if (!wallet) throw notFound(ErrorCode.USER_NOT_FOUND, '用户钱包不存在');
    return wallet;
  }

  async checkIn(userId: string) {
    const dateKey = beijingDateKey();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE
      `);
      const [user, wallet, existing] = await Promise.all([
        tx.user.findUnique({
          where: { id: userId },
          select: { experience: true, level: true, deletedAt: true },
        }),
        tx.wallet.findUnique({ where: { userId } }),
        tx.dailyCheckIn.findUnique({
          where: { userId_dateKey: { userId, dateKey } },
        }),
      ]);
      if (!user || user.deletedAt) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
      if (!wallet) throw notFound(ErrorCode.USER_NOT_FOUND, '用户钱包不存在');

      if (existing) {
        return {
          claimedNow: false,
          date: dateKey,
          rewardAmount: existing.rewardAmount,
          experienceAwarded: existing.experienceAwarded,
          balance: wallet.balance,
          progression: progressionFor(user.experience),
        };
      }

      const rewardAmount = BigInt(randomInt(1, 4));
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: rewardAmount } },
      });
      const transaction = await tx.walletTransaction.create({
        data: {
          type: 'DAILY_CHECK_IN',
          recipientWalletId: wallet.id,
          grossAmount: rewardAmount,
          recipientAmount: rewardAmount,
          platformAmount: 0,
          recipientBalanceAfter: updatedWallet.balance,
          recipientTipTotalAfter: updatedWallet.receivedTipTotal,
          recipientTipCountAfter: updatedWallet.receivedTipCount,
          dateKey,
        },
      });
      await tx.dailyCheckIn.create({
        data: {
          userId,
          walletId: wallet.id,
          walletTransactionId: transaction.id,
          dateKey,
          rewardAmount,
          experienceAwarded: 2,
        },
      });
      const experience = await this.progression.grantInTransaction(tx, {
        userId,
        type: 'DAILY_CHECK_IN',
        idempotencyKey: `experience:daily-check-in:${userId}:${dateKey}`,
        sourceType: 'DailyCheckIn',
        sourceId: transaction.id,
      });

      return {
        claimedNow: true,
        date: dateKey,
        rewardAmount,
        experienceAwarded: experience.delta,
        balance: updatedWallet.balance,
        progression: experience.progression,
      };
    });
  }

  async tipThread(
    sender: { id: string; username?: string },
    threadId: string,
    amountInput: string,
    clientRequestId: string,
  ) {
    const prepared = await this.prepareTip(
      sender.id,
      TipTargetType.THREAD,
      threadId,
      amountInput,
      clientRequestId,
    );
    if ('replay' in prepared) return prepared.replay;
    await this.threadAccess.assertAccessible(threadId, sender.id);
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId, deletedAt: null },
      select: { id: true, title: true, ownerId: true, published: true },
    });
    if (!thread || !thread.published) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
    return this.tip(
      sender,
      {
        type: 'THREAD',
        id: threadId,
        recipientId: thread.ownerId,
        threadId,
        threadTitle: thread.title,
      },
      clientRequestId,
      prepared,
    );
  }

  async tipUser(
    sender: { id: string; username?: string },
    recipientId: string,
    amountInput: string,
    clientRequestId: string,
  ) {
    if (sender.id === recipientId) {
      throw forbidden('不能给自己打赏', ErrorCode.TIP_NOT_ALLOWED);
    }
    const prepared = await this.prepareTip(
      sender.id,
      TipTargetType.USER,
      recipientId,
      amountInput,
      clientRequestId,
    );
    if ('replay' in prepared) return prepared.replay;
    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId, deletedAt: null },
      select: { id: true },
    });
    if (!recipient) throw notFound(ErrorCode.USER_NOT_FOUND, '用户不存在');
    return this.tip(
      sender,
      {
        type: 'USER',
        id: recipientId,
        recipientId,
      },
      clientRequestId,
      prepared,
    );
  }

  async tipMoment(
    sender: { id: string; username?: string },
    momentId: string,
    amountInput: string,
    clientRequestId: string,
  ) {
    const prepared = await this.prepareTip(
      sender.id,
      TipTargetType.MOMENT,
      momentId,
      amountInput,
      clientRequestId,
    );
    if ('replay' in prepared) return prepared.replay;
    const moment = await this.prisma.moment.findFirst({
      where: {
        id: momentId,
        deletedAt: null,
        author: {
          userBlocks: { none: { blockedId: sender.id } },
          blockedBy: { none: { blockerId: sender.id } },
        },
      },
      select: { id: true, authorId: true, title: true, author: { select: { deletedAt: true } } },
    });
    if (!moment) throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态不存在');
    if (moment.author.deletedAt)
      throw forbidden('已注销作者的历史动态不能接收加油', ErrorCode.TIP_NOT_ALLOWED);
    return this.tip(
      sender,
      {
        type: 'MOMENT',
        id: momentId,
        recipientId: moment.authorId,
        momentId,
        momentTitle: moment.title,
      },
      clientRequestId,
      prepared,
    );
  }

  async listTransactions(userId: string, cursor?: string, limit = 20) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) throw notFound(ErrorCode.USER_NOT_FOUND, '用户钱包不存在');
    if (cursor) {
      const cursorRow = await this.prisma.walletTransaction.findFirst({
        where: {
          id: cursor,
          OR: [{ senderWalletId: wallet.id }, { recipientWalletId: wallet.id }],
        },
        select: { id: true },
      });
      if (!cursorRow) {
        throw new BusinessException(
          ErrorCode.INVALID_CURSOR,
          '无效的钱包流水游标',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const take = Math.min(limit, 50);
    const rows = await this.prisma.walletTransaction.findMany({
      where: { OR: [{ senderWalletId: wallet.id }, { recipientWalletId: wallet.id }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        senderWallet: { include: { user: { select: publicUserSummarySelect } } },
        recipientWallet: { include: { user: { select: publicUserSummarySelect } } },
        targetThread: { select: { id: true, title: true } },
        targetUser: { select: publicUserSummarySelect },
        targetMoment: { select: { id: true, title: true } },
      },
    });
    const hasMore = rows.length > take;
    if (hasMore) rows.pop();

    const items = rows.map((row) => {
      const outgoing = row.senderWalletId === wallet.id;
      const counterparty = outgoing ? row.recipientWallet.user : (row.senderWallet?.user ?? null);
      const target =
        row.targetType === 'THREAD'
          ? {
              type: 'THREAD' as const,
              id: row.targetThread?.id ?? null,
              title: row.targetThread?.title ?? null,
            }
          : row.targetType === 'USER'
            ? {
                type: 'USER' as const,
                id: row.targetUser?.id ?? row.targetUserId,
                title: row.targetUser?.username ?? null,
              }
            : row.targetType === 'MOMENT'
              ? {
                  type: 'MOMENT' as const,
                  id: row.targetMoment?.id ?? row.targetMomentId,
                  title: row.targetMoment?.title ?? null,
                }
            : { type: 'NONE' as const, id: null, title: null };
      return {
        id: row.id,
        type: row.type,
        direction: outgoing ? ('EXPENSE' as const) : ('INCOME' as const),
        amount: outgoing ? row.grossAmount : row.recipientAmount,
        grossAmount: row.grossAmount,
        recipientAmount: row.recipientAmount,
        platformAmount: row.platformAmount,
        balanceAfter: outgoing ? (row.senderBalanceAfter ?? 0n) : row.recipientBalanceAfter,
        counterparty,
        target,
        createdAt: row.createdAt,
      };
    });
    return paginate(items, {
      cursor: items.length > 0 ? items[items.length - 1].id : null,
      hasMore,
    });
  }

  private async tip(
    sender: { id: string; username?: string },
    target: TipTarget,
    clientRequestId: string,
    prepared: PreparedTip,
  ) {
    const { amount, requestHash, senderWallet } = prepared;
    if (sender.id === target.recipientId) {
      throw forbidden('不能给自己打赏', ErrorCode.TIP_NOT_ALLOWED);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const [recipient, recipientWallet, platformWallet] = await Promise.all([
              tx.user.findUnique({
                where: { id: target.recipientId },
                select: { id: true, username: true, deletedAt: true },
              }),
              tx.wallet.findUnique({ where: { userId: target.recipientId } }),
              tx.wallet.findUnique({ where: { id: PLATFORM_WALLET_ID } }),
            ]);
            if (!recipient || !recipientWallet) throw notFound(ErrorCode.USER_NOT_FOUND, '收款用户不存在');
            if (!platformWallet)
              throw new BusinessException(
                ErrorCode.INTERNAL_ERROR,
                '平台钱包不存在',
                HttpStatus.INTERNAL_SERVER_ERROR,
              );

            const userIds = [sender.id, target.recipientId].sort();
            await tx.$queryRaw(Prisma.sql`
              SELECT "id" FROM "users"
              WHERE "id" IN (${Prisma.join(userIds)})
              ORDER BY "id" FOR UPDATE
            `);
            const currentSender = await tx.user.findUnique({ where: { id: sender.id }, select: { deletedAt: true } });
            if (!currentSender || currentSender.deletedAt) {
              throw new BusinessException(ErrorCode.ACCOUNT_DEACTIVATED, '账号已注销', HttpStatus.UNAUTHORIZED);
            }
            const currentRecipient = await tx.user.findUnique({ where: { id: target.recipientId }, select: { deletedAt: true } });
            if (!currentRecipient || currentRecipient.deletedAt) {
              if (target.type === 'MOMENT') {
                throw forbidden('已注销作者的历史动态不能接收加油', ErrorCode.TIP_NOT_ALLOWED);
              }
              throw notFound(ErrorCode.USER_NOT_FOUND, '收款用户不存在');
            }

            const walletIds = [senderWallet.id, recipientWallet.id, platformWallet.id].sort();
            await tx.$queryRaw(Prisma.sql`
            SELECT "id" FROM "wallets"
            WHERE "id" IN (${Prisma.join(walletIds)})
            ORDER BY "id" FOR UPDATE
          `);

            const replayInTransaction = await tx.walletTransaction.findUnique({
              where: {
                senderWalletId_clientRequestId: {
                  senderWalletId: senderWallet.id,
                  clientRequestId,
                },
              },
            });
            if (replayInTransaction) {
              this.assertReplayHash(replayInTransaction.requestHash, requestHash);
              return this.tipResponse(replayInTransaction);
            }

            const blocked = await tx.userBlock.findFirst({
              where: {
                OR: [
                  { blockerId: sender.id, blockedId: target.recipientId },
                  { blockerId: target.recipientId, blockedId: sender.id },
                ],
              },
              select: { id: true },
            });
            if (blocked) throw forbidden('存在拉黑关系，不能打赏', ErrorCode.TIP_NOT_ALLOWED);

            if (target.type === 'THREAD') {
              const currentThread = await tx.thread.findUnique({
                where: { id: target.threadId, deletedAt: null },
                select: { published: true, ownerId: true, visibility: true },
              });
              if (!currentThread?.published || currentThread.ownerId !== target.recipientId) {
                throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
              }
              if (currentThread.visibility === 'PRIVATE') {
                const membership = await tx.threadMember.findUnique({
                  where: {
                    threadId_userId: { threadId: target.threadId!, userId: sender.id },
                  },
                  select: { id: true },
                });
                if (!membership) throw notFound(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在');
              }
            }

            if (target.type === 'MOMENT') {
              await tx.$queryRaw`
                SELECT "id" FROM "moments" WHERE "id" = ${target.momentId} FOR UPDATE
              `;
              const currentMoment = await tx.moment.findUnique({
                where: { id: target.momentId, deletedAt: null },
                select: { authorId: true, author: { select: { deletedAt: true } } },
              });
              if (!currentMoment || currentMoment.authorId !== target.recipientId) {
                throw notFound(ErrorCode.MOMENT_NOT_FOUND, '动态不存在');
              }
              if (currentMoment.author.deletedAt) {
                throw forbidden('已注销作者的历史动态不能接收加油', ErrorCode.TIP_NOT_ALLOWED);
              }
            }

            const debited = await tx.wallet.updateMany({
              where: { id: senderWallet.id, balance: { gte: amount } },
              data: { balance: { decrement: amount } },
            });
            if (debited.count === 0) {
              throw new BusinessException(
                ErrorCode.INSUFFICIENT_WENYOU,
                '温油余额不足',
                HttpStatus.CONFLICT,
              );
            }
            const { recipientAmount, platformAmount } = splitTipAmount(amount);
            const [updatedSender, updatedRecipient, updatedPlatform] = await Promise.all([
              tx.wallet.findUniqueOrThrow({ where: { id: senderWallet.id } }),
              tx.wallet.update({
                where: { id: recipientWallet.id },
                data: {
                  balance: { increment: recipientAmount },
                  receivedTipTotal: { increment: amount },
                  receivedTipCount: { increment: 1 },
                },
              }),
              tx.wallet.update({
                where: { id: platformWallet.id },
                data: { balance: { increment: platformAmount } },
              }),
            ]);
            const updatedThread =
              target.type === 'THREAD'
                ? await tx.thread.update({
                    where: { id: target.threadId },
                    data: { tipTotal: { increment: amount } },
                    select: { tipTotal: true },
                  })
                : null;
            const updatedMoment =
              target.type === 'MOMENT'
                ? await tx.moment.update({
                    where: { id: target.momentId },
                    data: { tipTotal: { increment: amount } },
                    select: { tipTotal: true },
                  })
                : null;
            const transaction = await tx.walletTransaction.create({
              data: {
                type: 'TIP',
                senderWalletId: senderWallet.id,
                recipientWalletId: recipientWallet.id,
                platformWalletId: platformWallet.id,
                targetType: target.type,
                targetThreadId: target.threadId,
                targetUserId: target.recipientId,
                targetMomentId: target.momentId,
                grossAmount: amount,
                recipientAmount,
                platformAmount,
                senderBalanceAfter: updatedSender.balance,
                recipientBalanceAfter: updatedRecipient.balance,
                platformBalanceAfter: updatedPlatform.balance,
                threadTipTotalAfter: updatedThread?.tipTotal,
                momentTipTotalAfter: updatedMoment?.tipTotal,
                recipientTipTotalAfter: updatedRecipient.receivedTipTotal,
                recipientTipCountAfter: updatedRecipient.receivedTipCount,
                clientRequestId,
                requestHash,
              },
            });
            await this.outbox.enqueue(tx, {
              eventType: 'tip.completed',
              aggregateType: 'WalletTransaction',
              aggregateId: transaction.id,
              eventKey: `tip-completed:${transaction.id}`,
              payload: {
                transactionId: transaction.id,
                senderId: sender.id,
                senderUsername: sender.username ?? '有人',
                recipientId: target.recipientId,
                targetType: target.type,
                threadId: target.threadId ?? null,
                threadTitle: target.threadTitle ?? null,
                momentId: target.momentId ?? null,
                momentTitle: target.momentTitle ?? null,
                grossAmount: amount.toString(),
                recipientAmount: recipientAmount.toString(),
                platformAmount: platformAmount.toString(),
                threadTipTotal: updatedThread?.tipTotal.toString() ?? null,
                momentTipTotal: updatedMoment?.tipTotal.toString() ?? null,
              },
            });
            return this.tipResponse(transaction);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error: unknown) {
        if (isRetryableTransactionConflict(error)) {
          if (attempt < 2) continue;
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '打赏并发冲突，请重试',
            HttpStatus.CONFLICT,
          );
        }
        if ((error as { code?: string })?.code === 'P2002') {
          const racedReplay = await this.findTipReplay(
            senderWallet.id,
            clientRequestId,
            requestHash,
          );
          if (racedReplay) return this.tipResponse(racedReplay);
        }
        throw error;
      }
    }
    throw new BusinessException(ErrorCode.CONFLICT, '打赏并发冲突，请重试', HttpStatus.CONFLICT);
  }

  private async prepareTip(
    senderId: string,
    targetType: TipTargetType,
    targetId: string,
    amountInput: string,
    clientRequestId: string,
  ): Promise<PreparedTip | { replay: ReturnType<EconomyService['tipResponse']> }> {
    const amount = this.parseAmount(amountInput);
    const requestHash = hashIdempotencyPayload({
      targetType,
      targetId,
      amount: amount.toString(),
    });
    const senderWallet = await this.prisma.wallet.findUnique({
      where: { userId: senderId },
      select: { id: true },
    });
    if (!senderWallet) throw notFound(ErrorCode.USER_NOT_FOUND, '用户钱包不存在');
    const replay = await this.findTipReplay(senderWallet.id, clientRequestId, requestHash);
    if (replay) return { replay: this.tipResponse(replay) };
    return { amount, requestHash, senderWallet };
  }

  private parseAmount(input: string): bigint {
    let amount: bigint;
    try {
      amount = BigInt(input);
    } catch {
      throw new BusinessException(ErrorCode.INVALID_WENYOU_AMOUNT, '打赏金额必须是整数');
    }
    if (amount < 2n || amount > MAX_BIGINT) {
      throw new BusinessException(ErrorCode.INVALID_WENYOU_AMOUNT, '打赏金额超出可用范围');
    }
    return amount;
  }

  private async findTipReplay(
    senderWalletId: string,
    clientRequestId: string,
    requestHash: string,
  ) {
    const replay = await this.prisma.walletTransaction.findUnique({
      where: { senderWalletId_clientRequestId: { senderWalletId, clientRequestId } },
    });
    if (replay) this.assertReplayHash(replay.requestHash, requestHash);
    return replay;
  }

  private assertReplayHash(actual: string | null, expected: string) {
    if (actual !== expected) {
      throw new BusinessException(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        '同一幂等键不能用于不同打赏请求',
        HttpStatus.CONFLICT,
      );
    }
  }

  private tipResponse(transaction: {
    id: string;
    grossAmount: bigint;
    recipientAmount: bigint;
    platformAmount: bigint;
    senderBalanceAfter: bigint | null;
    threadTipTotalAfter: bigint | null;
    momentTipTotalAfter: bigint | null;
    recipientTipTotalAfter: bigint;
    recipientTipCountAfter: number;
  }) {
    return {
      transactionId: transaction.id,
      grossAmount: transaction.grossAmount,
      recipientAmount: transaction.recipientAmount,
      platformAmount: transaction.platformAmount,
      balance: transaction.senderBalanceAfter ?? 0n,
      ...(transaction.threadTipTotalAfter !== null
        ? { threadTipTotal: transaction.threadTipTotalAfter }
        : {}),
      ...(transaction.momentTipTotalAfter !== null
        ? { momentTipTotal: transaction.momentTipTotalAfter }
        : {}),
      recipientTipTotal: transaction.recipientTipTotalAfter,
      recipientTipCount: transaction.recipientTipCountAfter,
    };
  }
}
