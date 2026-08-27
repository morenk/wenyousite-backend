import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { ThreadAccessService } from '../src/access/thread-access.service';
import { GlobalAuthGuard } from '../src/auth/guards/global-auth.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ErrorCode } from '../src/common/exceptions/error-codes';
import { TransformInterceptor } from '../src/common/interceptors/response.interceptor';
import { EconomyController } from '../src/economy/economy.controller';
import { EconomyService } from '../src/economy/economy.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProgressionService } from '../src/progression/progression.service';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const JWT_SECRET = 'economy-terminal-e2e-access-secret-at-least-32-chars';

interface ApiEnvelope<T = Record<string, unknown>> {
  code: number;
  message: string;
  data: T;
  meta?: { cursor: string | null; hasMore: boolean };
}

interface TestUser {
  id: string;
  token: string;
  walletId: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function expectDatabaseFailure(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${message}: 数据库意外接受了非法写入`);
}

function readEnvValue(source: string, key: string) {
  const match = source.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

function testDatabaseUrl() {
  const fromProcess = process.env.DATABASE_URL;
  if (fromProcess) return fromProcess;
  const env = readFileSync(resolve('.env'), 'utf8');
  const fromFile = readEnvValue(env, 'DATABASE_URL');
  if (!fromFile) throw new Error('缺少 DATABASE_URL');
  return fromFile;
}

function isolatedDatabaseUrl(databaseUrl: string, database: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

function deployMigrations(databaseUrl: string) {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_DATABASE_URL: databaseUrl,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createTestUser(
  prisma: PrismaService,
  jwt: JwtService,
  label: string,
  options: { balance?: bigint } = {},
): Promise<TestUser> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const user = await prisma.user.create({
    data: {
      email: `${label}-${suffix}@example.test`,
      username: `${label}_${suffix}`.slice(0, 24),
      password: 'unused-in-economy-e2e',
    },
  });
  const wallet = await prisma.wallet.create({
    data: {
      kind: 'USER',
      userId: user.id,
      balance: options.balance ?? 0n,
    },
  });
  return {
    id: user.id,
    walletId: wallet.id,
    token: await jwt.signAsync({ sub: user.id }),
  };
}

async function verifyCheckInJourney(
  server: FastifyInstance,
  prisma: PrismaService,
  jwt: JwtService,
) {
  const checker = await createTestUser(prisma, jwt, 'checker');
  const first = await server.inject({
    method: 'POST',
    url: '/api/v1/wallet/check-in',
    headers: bearer(checker.token),
  });
  assertEqual(first.statusCode, HttpStatus.OK, '首次签到应成功');
  const firstBody = first.json() as ApiEnvelope<{
    claimedNow: boolean;
    rewardAmount: string;
    experienceAwarded: number;
    balance: string;
  }>;
  assertEqual(firstBody.data.claimedNow, true, '首次签到应实际领取');
  assert(['1', '2', '3'].includes(firstBody.data.rewardAmount), '签到奖励应为 1–3 升');
  assertEqual(firstBody.data.balance, firstBody.data.rewardAmount, '首次签到后余额应等于奖励');
  assertEqual(firstBody.data.experienceAwarded, 2, '签到应获得 2 经验');

  const replay = await server.inject({
    method: 'POST',
    url: '/api/v1/wallet/check-in',
    headers: bearer(checker.token),
  });
  assertEqual(replay.statusCode, HttpStatus.OK, '当日重复签到应返回成功快照');
  const replayBody = replay.json() as typeof firstBody;
  assertEqual(replayBody.data.claimedNow, false, '重复签到不应再次领取');
  assertEqual(replayBody.data.rewardAmount, firstBody.data.rewardAmount, '重放应返回原奖励');
  assertEqual(replayBody.data.balance, firstBody.data.balance, '重放不应增加余额');

  const [wallet, checkIns, ledgerRows, experienceEvents] = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { id: checker.walletId } }),
    prisma.dailyCheckIn.count({ where: { userId: checker.id } }),
    prisma.walletTransaction.count({
      where: { recipientWalletId: checker.walletId, type: 'DAILY_CHECK_IN' },
    }),
    prisma.experienceEvent.count({ where: { userId: checker.id, type: 'DAILY_CHECK_IN' } }),
  ]);
  assertEqual(
    wallet.balance.toString(),
    firstBody.data.rewardAmount,
    '数据库余额应与 API 快照一致',
  );
  assertEqual(checkIns, 1, '重复签到只能有一条签到记录');
  assertEqual(ledgerRows, 1, '重复签到只能有一条钱包流水');
  assertEqual(experienceEvents, 1, '重复签到只能有一条经验事件');

  const concurrent = await createTestUser(prisma, jwt, 'concurrent-checker');
  const concurrentResponses = await Promise.all([
    server.inject({
      method: 'POST',
      url: '/api/v1/wallet/check-in',
      headers: bearer(concurrent.token),
    }),
    server.inject({
      method: 'POST',
      url: '/api/v1/wallet/check-in',
      headers: bearer(concurrent.token),
    }),
  ]);
  assert(
    concurrentResponses.every((response) => response.statusCode === HttpStatus.OK),
    '并发签到请求都应返回可用结果',
  );
  const concurrentBodies = concurrentResponses.map(
    (response) => response.json() as ApiEnvelope<{ claimedNow: boolean; rewardAmount: string }>,
  );
  assertEqual(
    concurrentBodies.filter((body) => body.data.claimedNow).length,
    1,
    '并发签到只能有一次实际领取',
  );
  assertEqual(
    await prisma.dailyCheckIn.count({ where: { userId: concurrent.id } }),
    1,
    '并发签到只能落一条记录',
  );

  return checker;
}

async function verifyCheckInRollback(prisma: PrismaService) {
  const user = await prisma.user.create({
    data: {
      email: `rollback-${randomUUID()}@example.test`,
      username: `rollback_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
      password: 'unused-in-economy-e2e',
    },
  });
  const wallet = await prisma.wallet.create({ data: { kind: 'USER', userId: user.id } });
  const service = new EconomyService(
    prisma,
    new ThreadAccessService(prisma),
    {
      grantInTransaction: async () => {
        throw new Error('forced progression failure');
      },
    } as never,
    new OutboxService(),
  );

  let failed = false;
  try {
    await service.checkIn(user.id);
  } catch {
    failed = true;
  }
  assert(failed, '强制经验写入失败应使签到失败');
  const [walletAfter, checkIns, ledgerRows] = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } }),
    prisma.dailyCheckIn.count({ where: { userId: user.id } }),
    prisma.walletTransaction.count({ where: { recipientWalletId: wallet.id } }),
  ]);
  assertEqual(walletAfter.balance, 0n, '经验写入失败时钱包奖励应回滚');
  assertEqual(checkIns, 0, '经验写入失败时签到记录应回滚');
  assertEqual(ledgerRows, 0, '经验写入失败时钱包流水应回滚');
}

async function verifyTipJourney(
  server: FastifyInstance,
  prisma: PrismaService,
  jwt: JwtService,
  foreignCursorOwner: TestUser,
) {
  const sender = await createTestUser(prisma, jwt, 'sender', { balance: 10n });
  const recipient = await createTestUser(prisma, jwt, 'recipient');
  const platformBefore = await prisma.wallet.findUniqueOrThrow({
    where: { id: 'wallet_platform' },
  });
  const clientRequestId = randomUUID();
  const payload = { amount: '3', clientRequestId };

  const success = await server.inject({
    method: 'POST',
    url: `/api/v1/users/${recipient.id}/tips`,
    headers: bearer(sender.token),
    payload,
  });
  assertEqual(success.statusCode, HttpStatus.CREATED, '直接打赏应成功');
  const successBody = success.json() as ApiEnvelope<{
    transactionId: string;
    grossAmount: string;
    recipientAmount: string;
    platformAmount: string;
    balance: string;
    recipientTipTotal: string;
    recipientTipCount: number;
  }>;
  assertEqual(successBody.data.grossAmount, '3', '应返回用户投入总额');
  assertEqual(successBody.data.recipientAmount, '2', '3 升打赏收款人应到账 2 升');
  assertEqual(successBody.data.platformAmount, '1', '3 升打赏平台应收到 1 升');
  assertEqual(successBody.data.balance, '7', '付款人应剩余 7 升');

  const [senderWallet, recipientWallet, platformWallet, transaction, outboxCount] =
    await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: sender.walletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: recipient.walletId } }),
      prisma.wallet.findUniqueOrThrow({ where: { id: 'wallet_platform' } }),
      prisma.walletTransaction.findUniqueOrThrow({ where: { id: successBody.data.transactionId } }),
      prisma.domainOutbox.count({ where: { eventType: 'tip.completed' } }),
    ]);
  assertEqual(senderWallet.balance, 7n, '数据库应原子扣减付款人余额');
  assertEqual(recipientWallet.balance, 2n, '数据库应原子增加收款人余额');
  assertEqual(recipientWallet.receivedTipTotal, 3n, '累计打赏应按用户投入总额记录');
  assertEqual(recipientWallet.receivedTipCount, 1, '收款次数应增加一次');
  assertEqual(platformWallet.balance - platformBefore.balance, 1n, '平台余额应增加分成余数');
  assertEqual(
    senderWallet.balance +
      recipientWallet.balance +
      (platformWallet.balance - platformBefore.balance),
    10n,
    '打赏后三方资金应守恒',
  );
  assertEqual(transaction.senderBalanceAfter, 7n, '账本应保存付款后余额快照');
  assertEqual(outboxCount, 1, '打赏应与 Outbox 事件一起提交');

  const replay = await server.inject({
    method: 'POST',
    url: `/api/v1/users/${recipient.id}/tips`,
    headers: bearer(sender.token),
    payload,
  });
  assertEqual(replay.statusCode, HttpStatus.CREATED, '超时后重放应返回成功快照');
  assertEqual(
    JSON.stringify((replay.json() as typeof successBody).data),
    JSON.stringify(successBody.data),
    '幂等重放应返回原交易快照',
  );
  assertEqual(
    await prisma.walletTransaction.count({ where: { type: 'TIP' } }),
    1,
    '重放不应生成新账本',
  );
  assertEqual(
    await prisma.domainOutbox.count({ where: { eventType: 'tip.completed' } }),
    1,
    '重放不应生成新 Outbox',
  );

  const reused = await server.inject({
    method: 'POST',
    url: `/api/v1/users/${recipient.id}/tips`,
    headers: bearer(sender.token),
    payload: { amount: '4', clientRequestId },
  });
  assertEqual(reused.statusCode, HttpStatus.CONFLICT, '幂等键用于不同请求应返回 409');
  assertEqual(
    (reused.json() as ApiEnvelope<null>).code,
    ErrorCode.IDEMPOTENCY_KEY_REUSED,
    '应返回明确的幂等键复用错误码',
  );

  const beforeInsufficient = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { id: sender.walletId } }),
    prisma.wallet.findUniqueOrThrow({ where: { id: recipient.walletId } }),
    prisma.wallet.findUniqueOrThrow({ where: { id: 'wallet_platform' } }),
  ]);
  const insufficient = await server.inject({
    method: 'POST',
    url: `/api/v1/users/${recipient.id}/tips`,
    headers: bearer(sender.token),
    payload: { amount: '8', clientRequestId: randomUUID() },
  });
  assertEqual(insufficient.statusCode, HttpStatus.CONFLICT, '余额不足应返回 409');
  assertEqual(
    (insufficient.json() as ApiEnvelope<null>).code,
    ErrorCode.INSUFFICIENT_WENYOU,
    '余额不足应返回专用错误码',
  );
  const afterInsufficient = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { id: sender.walletId } }),
    prisma.wallet.findUniqueOrThrow({ where: { id: recipient.walletId } }),
    prisma.wallet.findUniqueOrThrow({ where: { id: 'wallet_platform' } }),
  ]);
  assert(
    beforeInsufficient.every(
      (wallet, index) => wallet.balance === afterInsufficient[index].balance,
    ),
    '余额不足不应改变任何钱包',
  );
  assertEqual(
    await prisma.walletTransaction.count({ where: { type: 'TIP' } }),
    1,
    '余额不足不应写账本',
  );

  const senderTransactions = await server.inject({
    method: 'GET',
    url: '/api/v1/wallet/transactions',
    headers: bearer(sender.token),
  });
  const senderList = senderTransactions.json() as ApiEnvelope<Array<Record<string, unknown>>>;
  assertEqual(senderList.data[0]?.direction, 'EXPENSE', '付款方流水应显示支出');
  assertEqual(senderList.data[0]?.amount, '3', '付款方支出应显示总额');
  assertEqual(senderList.data[0]?.balanceAfter, '7', '付款方流水应显示交易后余额');

  const recipientTransactions = await server.inject({
    method: 'GET',
    url: '/api/v1/wallet/transactions',
    headers: bearer(recipient.token),
  });
  const recipientList = recipientTransactions.json() as ApiEnvelope<Array<Record<string, unknown>>>;
  assertEqual(recipientList.data[0]?.direction, 'INCOME', '收款方流水应显示收入');
  assertEqual(recipientList.data[0]?.amount, '2', '收款方收入只显示实际到账');
  assert(
    typeof (recipientList.data[0]?.counterparty as Record<string, unknown>)?.username === 'string',
    '收款方私密流水应显示打赏者',
  );

  const foreignCursor = await server.inject({
    method: 'GET',
    url: `/api/v1/wallet/transactions?cursor=${successBody.data.transactionId}`,
    headers: bearer(foreignCursorOwner.token),
  });
  assertEqual(foreignCursor.statusCode, HttpStatus.BAD_REQUEST, '不属于当前钱包的游标应被拒绝');
  assertEqual(
    (foreignCursor.json() as ApiEnvelope<null>).code,
    ErrorCode.INVALID_CURSOR,
    '跨钱包游标应返回无效游标错误',
  );

  await prisma.wallet.update({ where: { id: sender.walletId }, data: { balance: 5n } });
  const recipientBeforeRace = await prisma.wallet.findUniqueOrThrow({
    where: { id: recipient.walletId },
  });
  const platformBeforeRace = await prisma.wallet.findUniqueOrThrow({
    where: { id: 'wallet_platform' },
  });
  const raceResponses = await Promise.all([
    server.inject({
      method: 'POST',
      url: `/api/v1/users/${recipient.id}/tips`,
      headers: bearer(sender.token),
      payload: { amount: '4', clientRequestId: randomUUID() },
    }),
    server.inject({
      method: 'POST',
      url: `/api/v1/users/${recipient.id}/tips`,
      headers: bearer(sender.token),
      payload: { amount: '4', clientRequestId: randomUUID() },
    }),
  ]);
  const raceStatuses = raceResponses.map((response) => response.statusCode).sort();
  assertEqual(
    raceStatuses.join(','),
    [HttpStatus.CREATED, HttpStatus.CONFLICT].sort().join(','),
    `余额只够一笔时，并发打赏应恰好一成一败；响应 ${raceResponses
      .map((response) => `${response.statusCode}:${response.body}`)
      .join(' | ')}`,
  );
  const [senderAfterRace, recipientAfterRace, platformAfterRace] = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { id: sender.walletId } }),
    prisma.wallet.findUniqueOrThrow({ where: { id: recipient.walletId } }),
    prisma.wallet.findUniqueOrThrow({ where: { id: 'wallet_platform' } }),
  ]);
  assertEqual(senderAfterRace.balance, 1n, '并发打赏不得将付款人扣成负数');
  assertEqual(
    recipientAfterRace.balance - recipientBeforeRace.balance,
    3n,
    '并发成功的 4 升应到账 3 升',
  );
  assertEqual(
    platformAfterRace.balance - platformBeforeRace.balance,
    1n,
    '并发成功的 4 升应分给平台 1 升',
  );

  await prisma.wallet.update({ where: { id: sender.walletId }, data: { balance: 2n } });
  const thread = await prisma.thread.create({
    data: {
      ownerId: recipient.id,
      title: '钱包 E2E 主题',
      published: true,
      publishedAt: new Date(),
      visibility: 'PUBLIC',
    },
  });
  const threadTip = await server.inject({
    method: 'POST',
    url: `/api/v1/threads/${thread.id}/tips`,
    headers: bearer(sender.token),
    payload: { amount: '2', clientRequestId: randomUUID() },
  });
  assertEqual(threadTip.statusCode, HttpStatus.CREATED, '公开已发布主题应可打赏');
  assertEqual(
    (threadTip.json() as ApiEnvelope<{ threadTipTotal: string }>).data.threadTipTotal,
    '2',
    '主题打赏应返回最新累计总额',
  );
  assertEqual(
    (await prisma.thread.findUniqueOrThrow({ where: { id: thread.id } })).tipTotal,
    2n,
    '主题打赏统计应与账本同事务更新',
  );

  const selfThreadTip = await server.inject({
    method: 'POST',
    url: `/api/v1/threads/${thread.id}/tips`,
    headers: bearer(recipient.token),
    payload: { amount: '2', clientRequestId: randomUUID() },
  });
  assertEqual(selfThreadTip.statusCode, HttpStatus.FORBIDDEN, '主题楼主不得给自己打赏');

  return { sender, recipient };
}

async function verifyLedgerDatabaseGuards(prisma: PrismaService, jwt: JwtService) {
  const checkIn = await prisma.dailyCheckIn.findFirstOrThrow({
    include: { walletTransaction: true },
  });
  const threadTip = await prisma.walletTransaction.findFirstOrThrow({
    where: { type: 'TIP', targetType: 'THREAD' },
  });

  await expectDatabaseFailure(
    () =>
      prisma.walletTransaction.update({
        where: { id: checkIn.walletTransactionId },
        data: { recipientBalanceAfter: { increment: 1n } },
      }),
    '钱包流水 UPDATE 应被 append-only 触发器拒绝',
  );
  await expectDatabaseFailure(
    () => prisma.walletTransaction.delete({ where: { id: checkIn.walletTransactionId } }),
    '钱包流水 DELETE 应被 append-only 触发器拒绝',
  );
  await expectDatabaseFailure(
    () =>
      prisma.dailyCheckIn.update({
        where: { id: checkIn.id },
        data: { rewardAmount: { increment: 1n } },
      }),
    '签到事实 UPDATE 应被 append-only 触发器拒绝',
  );
  await expectDatabaseFailure(
    () => prisma.dailyCheckIn.delete({ where: { id: checkIn.id } }),
    '签到事实 DELETE 应被 append-only 触发器拒绝',
  );
  await expectDatabaseFailure(
    () => prisma.$executeRawUnsafe('TRUNCATE TABLE "daily_check_ins"'),
    '签到事实 TRUNCATE 应被 append-only 触发器拒绝',
  );

  await expectDatabaseFailure(
    () =>
      prisma.walletTransaction.create({
        data: {
          type: 'DAILY_CHECK_IN',
          senderWalletId: checkIn.walletId,
          recipientWalletId: checkIn.walletId,
          grossAmount: 1n,
          recipientAmount: 1n,
          recipientBalanceAfter: 1n,
          dateKey: '2099-01-01',
        },
      }),
    '签到流水不得携带付款钱包',
  );
  await expectDatabaseFailure(
    () =>
      prisma.walletTransaction.create({
        data: {
          type: 'TIP',
          senderWalletId: threadTip.senderWalletId!,
          recipientWalletId: threadTip.recipientWalletId,
          platformWalletId: threadTip.platformWalletId!,
          targetType: 'THREAD',
          targetUserId: threadTip.targetUserId!,
          grossAmount: 2n,
          recipientAmount: 1n,
          platformAmount: 1n,
          senderBalanceAfter: 0n,
          recipientBalanceAfter: 1n,
          platformBalanceAfter: 1n,
          recipientTipTotalAfter: 2n,
          recipientTipCountAfter: 1,
          clientRequestId: randomUUID(),
          requestHash: 'invalid-target-shape',
        },
      }),
    '主题打赏必须且只能携带主题目标与累计快照',
  );
  await expectDatabaseFailure(
    () =>
      prisma.walletTransaction.create({
        data: {
          type: 'DAILY_CHECK_IN',
          recipientWalletId: checkIn.walletId,
          grossAmount: 1n,
          recipientAmount: 1n,
          recipientBalanceAfter: -1n,
          dateKey: '2099-01-02',
        },
      }),
    '钱包流水不得保存负数余额快照',
  );
  await expectDatabaseFailure(
    () =>
      prisma.walletTransaction.create({
        data: {
          type: 'DAILY_CHECK_IN',
          recipientWalletId: checkIn.walletId,
          grossAmount: 1n,
          recipientAmount: 1n,
          recipientBalanceAfter: 1n,
          dateKey: '2099-01-03',
        },
      }),
    '签到流水必须在同一事务中关联一条签到事实',
  );

  const mismatchUser = await createTestUser(prisma, jwt, 'guard-check-in');
  await expectDatabaseFailure(
    () =>
      prisma.$transaction(async (tx) => {
        const transaction = await tx.walletTransaction.create({
          data: {
            type: 'DAILY_CHECK_IN',
            recipientWalletId: mismatchUser.walletId,
            grossAmount: 1n,
            recipientAmount: 1n,
            recipientBalanceAfter: 1n,
            dateKey: '2099-02-01',
          },
        });
        await tx.dailyCheckIn.create({
          data: {
            userId: mismatchUser.id,
            walletId: mismatchUser.walletId,
            walletTransactionId: transaction.id,
            dateKey: '2099-02-02',
            rewardAmount: 1n,
          },
        });
      }),
    '签到事实的日期必须与对应流水一致',
  );

  const wrongPlatform = await createTestUser(prisma, jwt, 'guard-platform');
  await expectDatabaseFailure(
    () =>
      prisma.walletTransaction.create({
        data: {
          type: 'TIP',
          senderWalletId: threadTip.senderWalletId!,
          recipientWalletId: threadTip.recipientWalletId,
          platformWalletId: wrongPlatform.walletId,
          targetType: 'USER',
          targetUserId: threadTip.targetUserId!,
          grossAmount: 2n,
          recipientAmount: 1n,
          platformAmount: 1n,
          senderBalanceAfter: 0n,
          recipientBalanceAfter: 1n,
          platformBalanceAfter: 1n,
          recipientTipTotalAfter: 2n,
          recipientTipCountAfter: 1,
          clientRequestId: randomUUID(),
          requestHash: 'wrong-platform-kind',
        },
    }),
    '打赏平台方必须是平台钱包',
  );
  await expectDatabaseFailure(
    () =>
      prisma.walletTransaction.create({
        data: {
          type: 'TIP',
          senderWalletId: threadTip.senderWalletId!,
          recipientWalletId: threadTip.recipientWalletId,
          platformWalletId: threadTip.platformWalletId!,
          targetType: 'USER',
          targetUserId: wrongPlatform.id,
          grossAmount: 2n,
          recipientAmount: 1n,
          platformAmount: 1n,
          senderBalanceAfter: 0n,
          recipientBalanceAfter: 1n,
          platformBalanceAfter: 1n,
          recipientTipTotalAfter: 2n,
          recipientTipCountAfter: 1,
          clientRequestId: randomUUID(),
          requestHash: 'wrong-recipient-owner',
        },
      }),
    '打赏目标用户必须拥有收款钱包',
  );

  await prisma.thread.update({
    where: { id: threadTip.targetThreadId! },
    data: { deletedAt: new Date() },
  });
  await expectDatabaseFailure(
    () => prisma.thread.delete({ where: { id: threadTip.targetThreadId! } }),
    '被历史流水引用的主题不得硬删除',
  );
  assertEqual(
    (await prisma.walletTransaction.findUniqueOrThrow({ where: { id: threadTip.id } }))
      .targetThreadId,
    threadTip.targetThreadId,
    '主题软删除后流水目标 ID 应保持不变',
  );
}

async function verifyHttpBoundaries(
  server: FastifyInstance,
  prisma: PrismaService,
  jwt: JwtService,
) {
  const unauthenticated = await server.inject({ method: 'GET', url: '/api/v1/wallet' });
  assertEqual(unauthenticated.statusCode, HttpStatus.UNAUTHORIZED, '钱包私密数据必须登录访问');

  const reader = await createTestUser(prisma, jwt, 'reader');
  const readable = await server.inject({
    method: 'GET',
    url: '/api/v1/wallet',
    headers: bearer(reader.token),
  });
  assertEqual(readable.statusCode, HttpStatus.OK, '登录用户应能读取自己钱包');
  assertEqual(
    (readable.json() as ApiEnvelope<{ balance: string }>).data.balance,
    '0',
    '钱包 API 应将 BigInt 序列化为十进制字符串',
  );

  const checkIn = await server.inject({
    method: 'POST',
    url: '/api/v1/wallet/check-in',
    headers: bearer(reader.token),
  });
  assertEqual(checkIn.statusCode, HttpStatus.OK, '登录用户应能签到领取');

  const recipient = await createTestUser(prisma, jwt, 'validation-target');
  const invalidTip = await server.inject({
    method: 'POST',
    url: `/api/v1/users/${recipient.id}/tips`,
    headers: bearer(reader.token),
    payload: { amount: 2, clientRequestId: 'not-a-uuid' },
  });
  assertEqual(invalidTip.statusCode, HttpStatus.BAD_REQUEST, '无效打赏参数应被 DTO 拒绝');

  const verified = await createTestUser(prisma, jwt, 'validation-sender', { balance: 2n });
  const invalidVerifiedTip = await server.inject({
    method: 'POST',
    url: `/api/v1/users/${recipient.id}/tips`,
    headers: bearer(verified.token),
    payload: { amount: 2, clientRequestId: 'not-a-uuid' },
  });
  assertEqual(
    invalidVerifiedTip.statusCode,
    HttpStatus.BAD_REQUEST,
    '数字金额和非 UUID 幂等键应被 DTO 拒绝',
  );
}

async function verifyRuntime(databaseUrl: string) {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const config = {
    get: <T>(key: string) => (key === 'jwt.accessSecret' ? JWT_SECRET : undefined) as T,
  };
  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule.register({ defaultStrategy: 'jwt' }),
      JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: '15m' } }),
    ],
    controllers: [EconomyController],
    providers: [
      EconomyService,
      ThreadAccessService,
      ProgressionService,
      OutboxService,
      JwtStrategy,
      { provide: APP_GUARD, useClass: GlobalAuthGuard },
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  try {
    const server = app.getHttpAdapter().getInstance();
    const jwt = moduleRef.get(JwtService);
    await verifyHttpBoundaries(server, prisma, jwt);
    const checker = await verifyCheckInJourney(server, prisma, jwt);
    await verifyCheckInRollback(prisma);
    await verifyTipJourney(server, prisma, jwt, checker);
    await verifyLedgerDatabaseGuards(prisma, jwt);
  } finally {
    await app.close();
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function main() {
  if (process.env.ECONOMY_TERMINAL_E2E_ENV !== 'test') {
    throw new Error('ECONOMY_TERMINAL_E2E_ENV 必须显式设为 test');
  }
  const originalDatabaseUrl = testDatabaseUrl();
  const parsedDatabaseUrl = new URL(originalDatabaseUrl);
  if (!LOOPBACK_HOSTS.has(parsedDatabaseUrl.hostname)) {
    throw new Error('钱包 E2E 只允许使用本机 PostgreSQL');
  }

  const database = `wenyousite_economy_e2e_${process.pid}_${Date.now()}`;
  assert(/^wenyousite_economy_e2e_\d+_\d+$/.test(database), '临时测试数据库名称不符合安全约束');
  const isolatedUrl = isolatedDatabaseUrl(originalDatabaseUrl, database);
  const admin = new PrismaClient({ datasourceUrl: originalDatabaseUrl });
  let databaseCreated = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}" WITH TEMPLATE template0`);
    databaseCreated = true;
    deployMigrations(isolatedUrl);
    await verifyRuntime(isolatedUrl);
    process.stdout.write('钱包 PostgreSQL 与 API 核心旅程 E2E 通过\n');
  } finally {
    if (databaseCreated && process.env.ECONOMY_TERMINAL_E2E_KEEP_DATABASE !== '1') {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    }
    await admin.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
