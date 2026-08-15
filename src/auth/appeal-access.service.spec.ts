import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { APPEAL_TOKEN_TTL_SECONDS, AppealAccessService } from './appeal-access.service';

describe('AppealAccessService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const jwt = {
    signAsync: jest.fn(),
    decode: jest.fn(),
    verifyAsync: jest.fn(),
  };
  const config = {
    get: jest.fn().mockReturnValue('access-secret'),
  };
  const service = new AppealAccessService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    config.get.mockReturnValue('access-secret');
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
  });

  it('正确账号密码可签发短期申诉凭据，且不会创建普通登录终端', async () => {
    const password = await argon2.hash('Test1234!');
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'tester',
      role: UserRole.USER,
      password,
      deletedAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    jwt.signAsync.mockResolvedValue('appeal-token');

    const before = Date.now();
    const result = await service.issue(' Tester ', 'Test1234!');

    expect(result.appealToken).toBe('appeal-token');
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + APPEAL_TOKEN_TTL_SECONDS * 1000,
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ email: 'tester' }, { username: 'Tester' }] },
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: 'user-1', purpose: 'moderation-appeal' },
      expect.objectContaining({
        audience: 'wenyou-moderation-appeal',
        issuer: 'wenyousite-api',
        expiresIn: APPEAL_TOKEN_TTL_SECONDS,
        jwtid: expect.any(String),
        secret: expect.any(Buffer),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 15_000,
    });
  });

  it('第五次密码错误沿用账号锁定策略', async () => {
    const password = await argon2.hash('Test1234!');
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'tester',
      role: UserRole.USER,
      password,
      deletedAt: null,
      failedLoginAttempts: 4,
      lockedUntil: null,
    });

    await expect(service.issue('tester', 'wrong')).rejects.toMatchObject({
      errorCode: ErrorCode.ACCOUNT_LOCKED,
      status: 401,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginAttempts: 5, lockedUntil: expect.any(Date) },
    });
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('只识别专用 purpose，并将无效或失效凭据统一映射到 40120', async () => {
    jwt.decode
      .mockReturnValueOnce({ purpose: 'moderation-appeal' })
      .mockReturnValueOnce({ purpose: 'access' });
    expect(service.isAppealToken('appeal')).toBe(true);
    expect(service.isAppealToken('access')).toBe(false);

    jwt.verifyAsync.mockRejectedValue(new Error('expired'));
    await expect(service.authenticate('expired')).rejects.toMatchObject({
      errorCode: ErrorCode.APPEAL_TOKEN_INVALID,
      status: 401,
    });
  });

  it('有效申诉凭据恢复最小用户主体，注销账号不可继续使用', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', purpose: 'moderation-appeal' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'tester',
      role: UserRole.USER,
      deletedAt: null,
    });

    await expect(service.authenticate('valid')).resolves.toEqual({
      id: 'user-1',
      username: 'tester',
      role: UserRole.USER,
    });

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'tester',
      role: UserRole.USER,
      deletedAt: new Date(),
    });
    await expect(service.authenticate('valid')).rejects.toMatchObject({
      errorCode: ErrorCode.APPEAL_TOKEN_INVALID,
    });
  });
});
