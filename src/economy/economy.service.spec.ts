import { ErrorCode } from '../common/exceptions/error-codes';
import { hashIdempotencyPayload } from '../common/idempotency';
import { EconomyService } from './economy.service';

function buildService() {
  const prisma = {
    user: { findUnique: jest.fn() },
    wallet: { findUnique: jest.fn() },
    walletTransaction: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const access = { assertAccessible: jest.fn().mockResolvedValue(undefined) };
  const progression = { grantInTransaction: jest.fn() };
  const outbox = { enqueue: jest.fn() };
  return {
    service: new EconomyService(
      prisma as never,
      access as never,
      progression as never,
      outbox as never,
    ),
    prisma,
    access,
    progression,
    outbox,
  };
}

describe('EconomyService', () => {
  it.each(['0', '1', '-2', '2.5', 'abc', '9223372036854775808'])(
    '拒绝非法打赏金额 %s',
    async (amount) => {
      const { service, prisma } = buildService();

      await expect(
        service.tipUser(
          { id: 'sender-1' },
          'recipient-1',
          amount,
          '2e31a91c-7553-48a2-a53d-5b9d576778ee',
        ),
      ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_WENYOU_AMOUNT });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('相同幂等键和相同请求返回原交易快照', async () => {
    const { service, prisma } = buildService();
    prisma.wallet.findUnique.mockResolvedValue({ id: 'sender-wallet' });
    prisma.walletTransaction.findUnique.mockResolvedValue({
      id: 'transaction-1',
      requestHash: hashIdempotencyPayload({
        targetType: 'USER',
        targetId: 'recipient-1',
        amount: '10',
      }),
      grossAmount: 10n,
      recipientAmount: 8n,
      platformAmount: 2n,
      senderBalanceAfter: 90n,
      threadTipTotalAfter: null,
      recipientTipTotalAfter: 10n,
      recipientTipCountAfter: 1,
    });

    await expect(
      service.tipUser(
        { id: 'sender-1' },
        'recipient-1',
        '10',
        '2e31a91c-7553-48a2-a53d-5b9d576778ee',
      ),
    ).resolves.toEqual({
      transactionId: 'transaction-1',
      grossAmount: 10n,
      recipientAmount: 8n,
      platformAmount: 2n,
      balance: 90n,
      recipientTipTotal: 10n,
      recipientTipCount: 1,
    });
    expect(prisma.walletTransaction.findUnique).toHaveBeenCalledWith({
      where: {
        senderWalletId_clientRequestId: {
          senderWalletId: 'sender-wallet',
          clientRequestId: '2e31a91c-7553-48a2-a53d-5b9d576778ee',
        },
      },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('相同幂等键用于不同请求时拒绝且不进入事务', async () => {
    const { service, prisma } = buildService();
    prisma.wallet.findUnique.mockResolvedValue({ id: 'sender-wallet' });
    prisma.walletTransaction.findUnique.mockResolvedValue({
      requestHash: hashIdempotencyPayload({
        targetType: 'USER',
        targetId: 'recipient-1',
        amount: '10',
      }),
    });

    await expect(
      service.tipUser(
        { id: 'sender-1' },
        'recipient-1',
        '11',
        '2e31a91c-7553-48a2-a53d-5b9d576778ee',
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.IDEMPOTENCY_KEY_REUSED, status: 409 });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('禁止直接给自己打赏', async () => {
    const { service, prisma } = buildService();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

    await expect(
      service.tipUser({ id: 'user-1' }, 'user-1', '2', '2e31a91c-7553-48a2-a53d-5b9d576778ee'),
    ).rejects.toMatchObject({ errorCode: ErrorCode.TIP_NOT_ALLOWED });
    expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('余额不足时不写账本、统计或 Outbox', async () => {
    const { service, prisma, outbox } = buildService();
    prisma.wallet.findUnique.mockResolvedValue({ id: 'sender-wallet' });
    prisma.walletTransaction.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'recipient-1' });

    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'recipient-1', username: 'receiver' }),
      },
      wallet: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'recipient-wallet' })
          .mockResolvedValueOnce({ id: 'wallet-platform' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      walletTransaction: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
      thread: { findUnique: jest.fn(), update: jest.fn() },
      threadMember: { findUnique: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(
      service.tipUser(
        { id: 'sender-1' },
        'recipient-1',
        '10',
        '3e31a91c-7553-48a2-a53d-5b9d576778ee',
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INSUFFICIENT_WENYOU, status: 409 });
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['Prisma 事务冲突 P2034', { code: 'P2034' }],
    ['原始 SQL 序列化冲突 40001', { code: 'P2010', meta: { code: '40001' } }],
  ])('连续三次 %s 后返回可重试的业务冲突', async (_label, error) => {
    const { service, prisma } = buildService();
    prisma.wallet.findUnique.mockResolvedValue({ id: 'sender-wallet' });
    prisma.walletTransaction.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'recipient-1' });
    prisma.$transaction.mockRejectedValue(error);

    await expect(
      service.tipUser(
        { id: 'sender-1' },
        'recipient-1',
        '2',
        '4e31a91c-7553-48a2-a53d-5b9d576778ee',
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT, status: 409 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});
