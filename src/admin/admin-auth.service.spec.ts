import { ConfigService } from '@nestjs/config';
import { AdminSecurityEventType, UserRole, UserSanctionType } from '@prisma/client';
import * as argon2 from 'argon2';
import { ErrorCode } from '../common/exceptions/error-codes';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuthService } from './admin-auth.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
}));

describe('AdminAuthService', () => {
  const prisma = {
    $transaction: jest.fn(),
    user: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
    adminAuthChallenge: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    adminSession: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    adminSecurityEvent: { create: jest.fn() },
  };
  const config = { get: jest.fn() };
  const email = {
    sendAdminVerification: jest.fn(),
    sendAdminSessionAlert: jest.fn(),
  };
  const fingerprint = { ip: '127.0.0.1', userAgent: 'test-agent' };
  const adminUser = {
    id: 'admin-1',
    email: 'admin@example.test',
    username: 'admin',
    password: 'password-hash',
    role: UserRole.ADMIN,
    deletedAt: null,
    lockedUntil: null,
    sanctions: [],
  };
  let service: AdminAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: typeof prisma) => Promise<unknown>)(prisma);
    });
    prisma.adminAuthChallenge.updateMany.mockResolvedValue({ count: 1 });
    prisma.adminAuthChallenge.create.mockResolvedValue({});
    prisma.adminAuthChallenge.update.mockResolvedValue({});
    prisma.adminSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.adminSession.update.mockResolvedValue({});
    prisma.adminSecurityEvent.create.mockResolvedValue({});
    config.get.mockImplementation(
      (key: string) =>
        ({
          'admin.challengePepper': 'test-pepper',
          'admin.absoluteHours': 8,
          'admin.idleMinutes': 30,
          'admin.stepUpMinutes': 10,
        })[key],
    );
    (argon2.verify as jest.Mock).mockResolvedValue(true);
    (argon2.hash as jest.Mock).mockResolvedValue('dummy-hash');
    email.sendAdminVerification.mockResolvedValue(undefined);
    email.sendAdminSessionAlert.mockResolvedValue(undefined);
    service = new AdminAuthService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      email as unknown as EmailService,
    );
  });

  function challengeHash(challengeId: string, code: string) {
    return (
      service as unknown as {
        challengeHash: (id: string, value: string) => string;
      }
    ).challengeHash(challengeId, code);
  }

  it('密码验证成功后废弃旧挑战、记录安全事件并发送验证码', async () => {
    prisma.user.findFirst.mockResolvedValue(adminUser);

    const result = await service.createLoginChallenge(
      { account: ' ADMIN@example.test ', password: 'SecurePass123!' },
      fingerprint,
    );

    expect(result.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.expiresIn).toBe(600);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ email: 'admin@example.test' }, { username: 'ADMIN@example.test' }] },
      }),
    );
    expect(prisma.adminAuthChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'admin-1', purpose: 'LOGIN', consumedAt: null },
      }),
    );
    expect(prisma.adminSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AdminSecurityEventType.LOGIN_CHALLENGE_CREATED }),
      }),
    );
    expect(email.sendAdminVerification).toHaveBeenCalledWith(
      'admin@example.test',
      expect.stringMatching(/^\d{6}$/),
      'LOGIN',
    );
  });

  it.each([
    [null, true],
    [{ ...adminUser, role: UserRole.USER }, true],
    [{ ...adminUser, deletedAt: new Date() }, true],
    [{ ...adminUser, lockedUntil: new Date(Date.now() + 60_000) }, true],
    [adminUser, false],
  ])('拒绝不可用账号或错误密码 %#', async (user, passwordValid) => {
    prisma.user.findFirst.mockResolvedValue(user);
    (argon2.verify as jest.Mock).mockResolvedValue(passwordValid);

    await expect(
      service.createLoginChallenge({ account: 'admin', password: 'WrongPass123!' }, fingerprint),
    ).rejects.toMatchObject({ errorCode: ErrorCode.LOGIN_FAILED });
    expect(prisma.adminSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: AdminSecurityEventType.LOGIN_FAILED,
          metadata: { stage: 'password' },
        }),
      }),
    );
  });

  it('拒绝仍受封禁处罚的管理员', async () => {
    prisma.user.findFirst.mockResolvedValue({
      ...adminUser,
      sanctions: [{ type: UserSanctionType.BAN, endsAt: null }],
    });

    await expect(
      service.createLoginChallenge({ account: 'admin', password: 'SecurePass123!' }, fingerprint),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ACCOUNT_BANNED });
    expect(prisma.adminAuthChallenge.create).not.toHaveBeenCalled();
  });

  it('验证登录挑战后原子消费挑战、撤销旧会话并创建新会话', async () => {
    const challengeId = '550e8400-e29b-41d4-a716-446655440000';
    const code = '123456';
    prisma.adminAuthChallenge.findUnique.mockResolvedValue({
      id: challengeId,
      userId: 'admin-1',
      purpose: 'LOGIN',
      codeHash: challengeHash(challengeId, code),
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      user: adminUser,
    });
    prisma.adminSession.create.mockResolvedValue({
      id: 'session-1',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });

    const result = await service.verifyLoginChallenge(challengeId, code, fingerprint);

    expect(result.rawToken.length).toBeGreaterThan(20);
    expect(result.user).toEqual(expect.objectContaining({ id: 'admin-1', role: UserRole.ADMIN }));
    expect(prisma.adminSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.adminSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'admin-1', ip: '127.0.0.1' }),
      }),
    );
    expect(email.sendAdminSessionAlert).toHaveBeenCalled();
  });

  it('无效登录验证码增加尝试次数并记录失败阶段', async () => {
    const challengeId = '550e8400-e29b-41d4-a716-446655440000';
    prisma.adminAuthChallenge.findUnique.mockResolvedValue({
      id: challengeId,
      userId: 'admin-1',
      purpose: 'LOGIN',
      codeHash: challengeHash(challengeId, '111111'),
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      user: adminUser,
    });

    await expect(
      service.verifyLoginChallenge(challengeId, '222222', fingerprint),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ADMIN_CHALLENGE_INVALID });
    expect(prisma.adminAuthChallenge.update).toHaveBeenCalledWith({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    expect(prisma.adminSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metadata: { stage: 'email_code' } }),
      }),
    );
  });

  it('挑战验证后账号降权时消费挑战并拒绝创建会话', async () => {
    const challengeId = '550e8400-e29b-41d4-a716-446655440000';
    const code = '123456';
    prisma.adminAuthChallenge.findUnique.mockResolvedValue({
      id: challengeId,
      userId: 'admin-1',
      purpose: 'LOGIN',
      codeHash: challengeHash(challengeId, code),
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      user: { ...adminUser, role: UserRole.USER },
    });

    await expect(
      service.verifyLoginChallenge(challengeId, code, fingerprint),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ADMIN_CHALLENGE_INVALID });
    expect(prisma.adminAuthChallenge.update).toHaveBeenCalledWith({
      where: { id: challengeId },
      data: { consumedAt: expect.any(Date) },
    });
    expect(prisma.adminSession.create).not.toHaveBeenCalled();
  });

  it('校验有效会话并在活跃时间超过一分钟时刷新', async () => {
    prisma.adminSession.findUnique.mockResolvedValue({
      id: 'session-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastActiveAt: new Date(Date.now() - 61_000),
      elevatedUntil: new Date(Date.now() + 30_000),
      user: adminUser,
    });

    await expect(service.validateSession('raw-token')).resolves.toEqual(
      expect.objectContaining({
        id: 'admin-1',
        adminSessionId: 'session-1',
        role: UserRole.ADMIN,
        elevatedUntil: expect.any(String),
      }),
    );
    expect(prisma.adminSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { lastActiveAt: expect.any(Date) },
    });
  });

  it('拒绝缺失或失效会话，存在记录时条件撤销', async () => {
    await expect(service.validateSession()).rejects.toMatchObject({
      errorCode: ErrorCode.ADMIN_SESSION_REQUIRED,
    });
    prisma.adminSession.findUnique.mockResolvedValue({
      id: 'session-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1),
      lastActiveAt: new Date(),
      user: adminUser,
    });
    await expect(service.validateSession('expired-token')).rejects.toMatchObject({
      errorCode: ErrorCode.ADMIN_SESSION_EXPIRED,
    });
    expect(prisma.adminSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('读取会话详情并注销当前会话，记录安全事件', async () => {
    prisma.adminSession.findUniqueOrThrow.mockResolvedValue({ id: 'session-1' });
    await expect(service.getSession('session-1')).resolves.toEqual({
      session: { id: 'session-1' },
    });
    prisma.adminSession.update.mockResolvedValue({ userId: 'admin-1' });
    await expect(service.logout('session-1', fingerprint)).resolves.toEqual({
      message: '已退出站务台',
    });
    expect(prisma.adminSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AdminSecurityEventType.SESSION_REVOKED }),
      }),
    );
  });

  it('创建 Step-up 挑战时废弃旧挑战并发送专用验证码', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'admin@example.test' });

    const result = await service.createStepUpChallenge('admin-1', fingerprint);

    expect(result.expiresIn).toBe(600);
    expect(prisma.adminAuthChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'admin-1', purpose: 'STEP_UP', consumedAt: null },
      }),
    );
    expect(email.sendAdminVerification).toHaveBeenCalledWith(
      'admin@example.test',
      expect.stringMatching(/^\d{6}$/),
      'STEP_UP',
    );
  });

  it('验证 Step-up 后同时消费挑战并提升当前会话', async () => {
    const challengeId = '550e8400-e29b-41d4-a716-446655440000';
    const code = '123456';
    prisma.adminAuthChallenge.findFirst.mockResolvedValue({
      id: challengeId,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      codeHash: challengeHash(challengeId, code),
    });

    const result = await service.verifyStepUp(
      'session-1',
      'admin-1',
      challengeId,
      code,
      fingerprint,
    );

    expect(result.elevatedUntil).toBeInstanceOf(Date);
    expect(prisma.adminSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { elevatedUntil: expect.any(Date) },
    });
    expect(prisma.adminSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AdminSecurityEventType.STEP_UP_SUCCEEDED }),
      }),
    );
  });

  it('无效 Step-up 增加尝试次数并记录失败事件', async () => {
    const challengeId = '550e8400-e29b-41d4-a716-446655440000';
    prisma.adminAuthChallenge.findFirst.mockResolvedValue({
      id: challengeId,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
      codeHash: challengeHash(challengeId, '111111'),
    });

    await expect(
      service.verifyStepUp('session-1', 'admin-1', challengeId, '222222', fingerprint),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ADMIN_CHALLENGE_INVALID });
    expect(prisma.adminAuthChallenge.update).toHaveBeenCalledWith({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    expect(prisma.adminSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: AdminSecurityEventType.STEP_UP_FAILED }),
      }),
    );
  });

  it('高风险操作只接受仍有效的 Step-up 时间', () => {
    expect(() => service.requireStepUp()).toThrow(
      expect.objectContaining({
        errorCode: ErrorCode.ADMIN_STEP_UP_REQUIRED,
      }),
    );
    expect(() => service.requireStepUp(new Date(Date.now() - 1).toISOString())).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.ADMIN_STEP_UP_REQUIRED }),
    );
    expect(() => service.requireStepUp(new Date(Date.now() + 60_000).toISOString())).not.toThrow();
  });
});
