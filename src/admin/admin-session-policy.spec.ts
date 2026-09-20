import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminLoginVerifyDto, AdminChallengeVerifyDto } from './dto/admin-auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { EmailService } from '../email/email.service';

describe('管理员设备会话策略', () => {
  const now = new Date('2026-09-21T00:00:00Z');
  const config = {
    get: (key: string) =>
      ({
        'admin.idleMinutes': 30,
        'admin.absoluteHours': 8,
        'app.nodeEnv': 'production',
      })[key],
  } as unknown as ConfigService;
  const user = {
    id: 'u',
    email: 'a@test.invalid',
    username: 'admin',
    role: 'ADMIN',
    deletedAt: null,
    sanctions: [],
  };
  const prisma = {
    adminSession: { findUnique: jest.fn(), update: jest.fn() },
  };
  let service: AdminAuthService;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    service = new AdminAuthService(prisma as unknown as PrismaService, config, {} as EmailService);
  });
  afterEach(() => jest.useRealTimers());

  it.each([true, false, undefined])('登录接受布尔或省略：%s', async (rememberDevice) => {
    expect(
      await validate(
        plainToInstance(AdminLoginVerifyDto, {
          challengeId: '550e8400-e29b-41d4-a716-446655440000',
          code: '123456',
          rememberDevice,
        }),
      ),
    ).toHaveLength(0);
  });
  it.each([null, 'true', 'false', 1, 0])('不将非法选项转成记住设备：%s', async (rememberDevice) => {
    expect(
      await validate(
        plainToInstance(AdminLoginVerifyDto, {
          challengeId: '550e8400-e29b-41d4-a716-446655440000',
          code: '123456',
          rememberDevice,
        }),
      ),
    ).not.toHaveLength(0);
  });
  it('step-up 保持原 DTO，不接受记住设备选项', async () => {
    expect(
      await validate(
        plainToInstance(AdminChallengeVerifyDto, {
          challengeId: '550e8400-e29b-41d4-a716-446655440000',
          code: '123456',
          rememberDevice: true,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).not.toHaveLength(0);
  });

  it.each([
    [false, 30 * 60_000, 8 * 60 * 60_000, true],
    [false, 30 * 60_000 + 1, 8 * 60 * 60_000, false],
    [false, 0, 0, false],
    [true, 6 * 24 * 60 * 60_000, 1, true],
    [true, 1, 0, false],
  ])(
    '受控时间 remember=%s idle=%s remaining=%s valid=%s',
    async (rememberDevice, idle, remaining, valid) => {
      prisma.adminSession.findUnique.mockResolvedValue({
        id: 's',
        rememberDevice,
        revokedAt: null,
        lastActiveAt: new Date(now.getTime() - idle),
        expiresAt: new Date(now.getTime() + remaining),
        user,
      });
      if (valid) {
        await expect(service.validateSession('token')).resolves.toMatchObject({
          adminSessionId: 's',
        });
        expect(prisma.adminSession.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ expiresAt: expect.anything() }),
          }),
        );
      } else {
        await expect(service.validateSession('token')).rejects.toMatchObject({
          errorCode: ErrorCode.ADMIN_SESSION_EXPIRED,
        });
      }
    },
  );

  it.each([false, true])(
    'Cookie沿用安全属性并使用所选绝对期限 remember=%s',
    async (rememberDevice) => {
      const seconds = rememberDevice ? 7 * 24 * 3600 : 8 * 3600;
      const auth = {
        verifyLoginChallenge: jest.fn().mockResolvedValue({
          rawToken: 'test-token',
          session: { id: 's', expiresAt: new Date(now.getTime() + seconds * 1000) },
          user,
        }),
      };
      const controller = new AdminAuthController(auth as unknown as AdminAuthService, config);
      const reply = { setCookie: jest.fn(), generateCsrf: () => 'csrf' };
      await controller.verify(
        { challengeId: 'id', code: '123456', rememberDevice },
        { ip: '127.0.0.1', headers: {} } as FastifyRequest,
        reply as unknown as FastifyReply,
      );
      expect(auth.verifyLoginChallenge).toHaveBeenCalledWith(
        'id',
        '123456',
        { ip: '127.0.0.1', userAgent: undefined },
        rememberDevice,
      );
      expect(reply.setCookie).toHaveBeenCalledWith('__Secure-wenyou-admin-session', 'test-token', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/v1/admin',
        maxAge: seconds,
      });
    },
  );
});
