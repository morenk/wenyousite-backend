import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

const user = {
  id: 'u1',
  email: 'user@example.com',
  username: 'tester',
  avatar: null,
  role: 'USER',
  emailVerified: true,
  deletedAt: null,
};

describe('JwtStrategy 登录终端校验', () => {
  const mockPrisma = {
    user: { findUnique: jest.fn() },
    refreshToken: { findFirst: jest.fn() },
  };
  const config = { get: jest.fn().mockReturnValue('test-access-secret') } as unknown as ConfigService;
  const strategy = new JwtStrategy(config, mockPrisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.refreshToken.findFirst.mockResolvedValue({ id: 'rt1' });
  });

  it('sid 对应活跃终端时挂载稳定 sessionId', async () => {
    await expect(strategy.validate({ sub: 'u1', sid: 'family-1' })).resolves.toEqual({
      ...user,
      sessionId: 'family-1',
    });
    expect(mockPrisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        family: 'family-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
  });

  it('终端被远程退出后立即拒绝尚未过期的 access token', async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue(null);

    await expect(strategy.validate({ sub: 'u1', sid: 'revoked-family' }))
      .rejects.toThrow(UnauthorizedException);
  });

  it('兼容部署前签发的无 sid access token', async () => {
    await expect(strategy.validate({ sub: 'u1' })).resolves.toEqual({
      ...user,
      sessionId: undefined,
    });
    expect(mockPrisma.refreshToken.findFirst).not.toHaveBeenCalled();
  });
});
