import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { MomentAccessService } from './moment-access.service';

function visibleMoment(deletedAt: Date | null = null) {
  return {
    id: 'moment-1',
    authorId: 'author-1',
    title: '历史动态',
    author: { deletedAt },
  };
}

function createContext() {
  const tx = {
    userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
    moment: {
      findUnique: jest.fn().mockResolvedValue({ authorId: 'author-1' }),
      findFirst: jest.fn().mockResolvedValue(visibleMoment()),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
    moment: { findFirst: jest.fn() },
  };
  return {
    tx,
    prisma,
    service: new MomentAccessService(prisma as never),
  };
}

describe('MomentAccessService', () => {
  it('统一把不存在、删除和拉黑不可见映射为 MOMENT_NOT_FOUND', async () => {
    const { prisma, service } = createContext();
    prisma.moment.findFirst.mockResolvedValue(null);

    const error = await service.assertVisible('moment-1', 'viewer-1').catch((reason) => reason);

    expect(error).toBeInstanceOf(BusinessException);
    expect(error).toMatchObject({ errorCode: ErrorCode.MOMENT_NOT_FOUND });
    expect((error as BusinessException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(prisma.moment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'moment-1',
          deletedAt: null,
          author: {
            userBlocks: { none: { blockedId: 'viewer-1' } },
            blockedBy: { none: { blockerId: 'viewer-1' } },
          },
        }),
      }),
    );
  });

  it('互动写入按用户后动态的全局顺序加锁并在锁后重新校验可见性', async () => {
    const { tx, service } = createContext();

    await expect(
      service.lockVisible(tx as never, 'moment-1', 'viewer-1', ['reply-author-1']),
    ).resolves.toEqual(visibleMoment());

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[1],
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.moment.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('保留已注销作者的历史动态读取，但禁止新增互动', () => {
    const { service } = createContext();
    const moment = visibleMoment(new Date('2026-08-23T00:00:00.000Z'));

    expect(() => service.assertCanAddInteraction(moment)).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.FORBIDDEN }),
    );
  });

  it('发布在用户锁后阻止与账号注销竞态产生新动态', async () => {
    const { tx, service } = createContext();
    tx.user.findUnique.mockResolvedValue({
      deletedAt: new Date('2026-08-23T00:00:00.000Z'),
    });

    const error = await service.lockActiveUser(tx as never, 'viewer-1').catch((reason) => reason);

    expect(error).toBeInstanceOf(BusinessException);
    expect(error).toMatchObject({ errorCode: ErrorCode.ACCOUNT_DEACTIVATED });
    expect((error as BusinessException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('互动在用户锁后阻止已先完成的账号注销继续写入', async () => {
    const { tx, service } = createContext();
    tx.user.findUnique.mockResolvedValue({
      deletedAt: new Date('2026-08-23T00:00:00.000Z'),
    });

    const error = await service
      .lockVisible(tx as never, 'moment-1', 'viewer-1')
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(BusinessException);
    expect(error).toMatchObject({ errorCode: ErrorCode.ACCOUNT_DEACTIVATED });
    expect((error as BusinessException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.moment.findFirst).not.toHaveBeenCalled();
  });

  it('目标不存在时在申请用户锁前拒绝写入', async () => {
    const { tx, service } = createContext();
    tx.moment.findUnique.mockResolvedValue(null);

    await expect(service.lockVisible(tx as never, 'missing', 'viewer-1')).rejects.toMatchObject({
      errorCode: ErrorCode.MOMENT_NOT_FOUND,
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.moment.findFirst).not.toHaveBeenCalled();
  });

  it('撤回已有互动仍锁定双方并校验账号，但不因新拉黑关系阻止撤回', async () => {
    const { tx, service } = createContext();

    await expect(
      service.lockVisible(tx as never, 'moment-1', 'viewer-1', [], false),
    ).resolves.toEqual(visibleMoment());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'viewer-1' },
      select: { deletedAt: true },
    });
    expect(tx.userBlock.findFirst).not.toHaveBeenCalled();
    expect(tx.moment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'moment-1', deletedAt: null },
      }),
    );
  });

  it('已不存在的操作者不能发布，活跃操作者可以发布与互动', async () => {
    const { tx, service } = createContext();
    tx.user.findUnique.mockResolvedValueOnce(null);

    await expect(service.lockActiveUser(tx as never, 'missing')).rejects.toMatchObject({
      errorCode: ErrorCode.ACCOUNT_DEACTIVATED,
    });
    await expect(service.lockActiveUser(tx as never, 'viewer-1')).resolves.toBeUndefined();
    expect(() => service.assertCanAddInteraction(visibleMoment())).not.toThrow();
  });
});
