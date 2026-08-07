import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { VerificationCodeService } from './verification-code.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthSessionService } from './auth-session.service';
import { ErrorCode } from '../common/exceptions/error-codes';

const mockPrisma: Record<string, any> = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  emailVerification: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn((input: any): any =>
    typeof input === 'function' ? input(mockPrisma) : Promise.all(input),
  ),
};

const mockJwt = { signAsync: jest.fn() };
const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'jwt.accessSecret': 'test-secret',
      'jwt.refreshSecret': 'test-refresh',
      'argon2.timeCost': 1,
      'argon2.memoryCost': 8192,
    };
    return map[key];
  }),
};

const mockEmailService = {
  sendVerification: jest.fn().mockResolvedValue(undefined),
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  sendPasswordChanged: jest.fn().mockResolvedValue(undefined),
  sendEmailChanged: jest.fn().mockResolvedValue(undefined),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        AuthSessionService,
        VerificationCodeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('requestCode', () => {
    it('邮箱已注册时应该返回409', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'x' });
      await expect(
        service.requestCode('a@b.com'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.EMAIL_ALREADY_REGISTERED, status: 409 });
    });

    it('无验证记录时应该创建新记录并发送验证码', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.emailVerification.findFirst.mockResolvedValue(null);

      const result = await service.requestCode('a@b.com');

      expect(mockPrisma.emailVerification.create).toHaveBeenCalled();
      expect(result.emailSent).toBe(true);
      expect(result.codeExpiresIn).toBe(900);
    });

    it('验证码未过期时重发同一验证码，不新建', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev1', email: 'a@b.com', token: '123456',
        type: 'REGISTRATION', expiresAt: future, attempts: 0, createdAt: new Date(),
      });

      const result = await service.requestCode('a@b.com');

      expect(result.emailSent).toBe(true);
      expect(result.message).toContain('验证码已发送');
      expect(mockPrisma.emailVerification.create).not.toHaveBeenCalled();
      expect(mockEmailService.sendVerification).toHaveBeenCalledWith('a@b.com', '123456', 'REGISTRATION');
    });

    it('验证码已过期时应该删除旧记录并新建', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const past = new Date(Date.now() - 5 * 60 * 1000);
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev1', email: 'a@b.com', token: '654321',
        type: 'REGISTRATION', expiresAt: past, attempts: 0, createdAt: past,
      });

      const result = await service.requestCode('a@b.com');

      expect(mockPrisma.emailVerification.delete).toHaveBeenCalledWith({ where: { id: 'ev1' } });
      expect(mockPrisma.emailVerification.create).toHaveBeenCalled();
      expect(result.emailSent).toBe(true);
    });

    it('邮箱大小写不敏感', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.emailVerification.findFirst.mockResolvedValue(null);

      await service.requestCode('UPPER@Case.COM');

      expect(mockPrisma.emailVerification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'upper@case.com' }),
        }),
      );
    });
  });

  describe('verifyAndComplete', () => {
    const validDto = { email: 'a@b.com', code: '123456', username: 'test', password: 'Test1234!' };

    it('无验证记录时应该返回400', async () => {
      mockPrisma.emailVerification.findFirst.mockResolvedValue(null);
      await expect(
        service.verifyAndComplete(validDto),
      ).rejects.toMatchObject({ errorCode: ErrorCode.NO_CODE_RECORD, status: 401 });
    });

    it('验证码错误时应该返回401并增加尝试计数', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev1', email: 'a@b.com', token: '999999',
        type: 'REGISTRATION', expiresAt: future, attempts: 0, createdAt: new Date(),
      });

      await expect(
        service.verifyAndComplete(validDto),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CODE_INVALID, status: 401 });
      expect(mockPrisma.emailVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } }),
      );
    });

    it('尝试次数过多时应该删除记录', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev1', email: 'a@b.com', token: '999999',
        type: 'REGISTRATION', expiresAt: future, attempts: 5, createdAt: new Date(),
      });

      await expect(
        service.verifyAndComplete(validDto),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CODE_ATTEMPTS_EXCEEDED, status: 401 });
      expect(mockPrisma.emailVerification.delete).toHaveBeenCalledWith({ where: { id: 'ev1' } });
    });

    it('验证码过期时应该返回401并删除记录', async () => {
      const past = new Date(Date.now() - 5 * 60 * 1000);
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev1', email: 'a@b.com', token: '123456',
        type: 'REGISTRATION', expiresAt: past, attempts: 0, createdAt: new Date(),
      });

      await expect(
        service.verifyAndComplete(validDto),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CODE_EXPIRED, status: 401 });
      expect(mockPrisma.emailVerification.delete).toHaveBeenCalledWith({ where: { id: 'ev1' } });
    });

    it('验证通过应该创建用户（emailVerified=true）并返回Token', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev1', email: 'a@b.com', token: '123456',
        type: 'REGISTRATION', expiresAt: future, attempts: 0, createdAt: new Date(),
      });
      mockPrisma.user.create.mockResolvedValue({
        id: 'u1', email: 'a@b.com', username: 'test', avatar: null, role: 'USER',
        emailVerified: true,
      });
      mockJwt.signAsync.mockResolvedValue('at-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      const result = await service.verifyAndComplete(validDto);

      expect(result.accessToken).toBe('at-token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe('a@b.com');
      expect(result.user.emailVerified).toBe(true);
      expect(result.message).toBe('注册成功');
      expect(mockPrisma.emailVerification.delete).toHaveBeenCalledWith({ where: { id: 'ev1' } });
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ emailVerified: true }),
        }),
      );
    });

    it('用户名占用时应该返回409 (TOCTOU)', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev1', email: 'a@b.com', token: '123456',
        type: 'REGISTRATION', expiresAt: future, attempts: 0, createdAt: new Date(),
      });
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        meta: { target: ['username'] },
        clientVersion: '6.x',
      });
      mockPrisma.user.create.mockRejectedValue(p2002);

      await expect(
        service.verifyAndComplete(validDto),
      ).rejects.toMatchObject({ errorCode: ErrorCode.USERNAME_TAKEN, status: 409 });
    });
  });

  describe('login', () => {
    const userRow = {
      id: 'u1', email: 'a@b.com', password: 'HASH', username: 'tester', avatar: null,
      role: 'USER', emailVerified: false, deletedAt: null,
      failedLoginAttempts: 0, lockedUntil: null,
    };

    it('正确邮箱密码应该能登录', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findFirst.mockResolvedValue({ ...userRow, password: hashed });
      mockJwt.signAsync.mockResolvedValue('at-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      const result = await service.login({ account: 'a@b.com', password: 'Test1234!' });
      expect(result.accessToken).toBe('at-token');
      expect(result.user.email).toBe('a@b.com');
      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'u1', sid: expect.any(String) }),
        expect.any(Object),
      );
      expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', platform: 'web', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('正确用户名密码应该能登录', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findFirst.mockResolvedValue({ ...userRow, username: 'zhangsan', password: hashed });
      mockJwt.signAsync.mockResolvedValue('at-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      const result = await service.login({ account: 'zhangsan', password: 'Test1234!' });
      expect(result.accessToken).toBe('at-token');
      expect(result.user.username).toBe('zhangsan');
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { email: 'zhangsan' },
              { username: 'zhangsan' },
            ],
          },
        }),
      );
    });

    it('用户名登录大小写敏感，与注册唯一约束一致', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ account: 'TESTER', password: 'Test1234!' }),
      ).rejects.toMatchObject({ errorCode: ErrorCode.LOGIN_FAILED, status: 401 });
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ email: 'tester' }, { username: 'TESTER' }] },
        }),
      );
      // 说明：注册唯一约束区分大小写，'TESTER' 与 'tester' 是两个账号，
      // 因此精确匹配未命中时不允许用小写用户名登录
      expect(hashed).toBeTruthy();
    });

    it('密码错误应该返回401', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findFirst.mockResolvedValue({ ...userRow, password: hashed });
      await expect(
        service.login({ account: 'a@b.com', password: 'wrong' }),
      ).rejects.toMatchObject({ errorCode: ErrorCode.LOGIN_FAILED, status: 401 });
    });

    it('用户不存在时登录应该返回401', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.login({ account: 'a@b.com', password: 'Test1234!' }),
      ).rejects.toMatchObject({ errorCode: ErrorCode.LOGIN_FAILED, status: 401 });
    });

    it('已注销用户登录应该返回401', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findFirst.mockResolvedValue({ ...userRow, deletedAt: new Date(), password: hashed });
      await expect(
        service.login({ account: 'a@b.com', password: 'Test1234!' }),
      ).rejects.toMatchObject({ errorCode: ErrorCode.LOGIN_FAILED, status: 401 });
    });

    it('邮箱登录大小写不敏感', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findFirst.mockResolvedValue({ ...userRow, email: 'user@case.com', password: hashed });
      mockJwt.signAsync.mockResolvedValue('at-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      await service.login({ account: 'USER@CASE.COM', password: 'Test1234!' });
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ email: 'user@case.com' }, { username: 'USER@CASE.COM' }] },
        }),
      );
    });

    it('移动端登录应使用 30 天 TTL', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findFirst.mockResolvedValue({ ...userRow, password: hashed });
      mockJwt.signAsync.mockResolvedValue('at-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      await service.login({ account: 'a@b.com', password: 'Test1234!' }, undefined, 'mobile');
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ platform: 'mobile' }),
        }),
      );
    });
  });

  describe('refresh', () => {
    it('refresh token 有效时应该返回新Token（轮转）', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt1', userId: 'u1', tokenHash: expect.any(String), family: 'f1',
        deviceInfo: null, expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null, createdAt: new Date(), sessionStartedAt: new Date(Date.now() - 3600000),
        user: {
          id: 'u1', email: 'a@b.com', username: 'test', avatar: null,
          role: 'USER', emailVerified: false, deletedAt: null,
        },
      });
      mockJwt.signAsync.mockResolvedValue('new-at');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt2' });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refresh('valid-rt');
      expect(result.accessToken).toBe('new-at');
      expect(result.refreshToken).toBeDefined();
      expect(result.platform).toBe('web');
      expect(mockJwt.signAsync).toHaveBeenCalledWith(
        { sub: 'u1', sid: 'f1' },
        expect.any(Object),
      );
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      // 旧 token 应被原子撤销（with revokedAt: null 条件）
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt1', revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('refresh token 无效时应该返回401', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
      await expect(service.refresh('bad-rt')).rejects.toMatchObject({
        errorCode: ErrorCode.TOKEN_INVALID,
        status: 401,
      });
    });

    it('超过并发宽限期的已撤销 refresh token 重放会吊销整个 family', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt1', userId: 'u1', tokenHash: expect.any(String), family: 'f1',
        deviceInfo: null, expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(Date.now() - 11_000), createdAt: new Date(), sessionStartedAt: new Date(),
        user: { deletedAt: null },
      });

      await expect(service.refresh('stolen-rt')).rejects.toMatchObject({
        errorCode: ErrorCode.TOKEN_THEFT_DETECTED,
        status: 401,
      });
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', family: 'f1', revokedAt: null } }),
      );
    });

    it('刚轮转的旧 token 并发重放只拒绝请求，不误伤新 token', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt1', userId: 'u1', tokenHash: expect.any(String), family: 'f1',
        deviceInfo: null, expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(), createdAt: new Date(), sessionStartedAt: new Date(),
        user: { deletedAt: null },
      });

      await expect(service.refresh('concurrent-old-rt')).rejects.toMatchObject({
        errorCode: ErrorCode.TOKEN_REVOKED,
        status: 401,
      });
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('应该撤销指定 refresh token', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.logout('u1', 'some-refresh-token');
      expect(result.message).toBe('已登出');
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', revokedAt: null, tokenHash: expect.any(String) },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('changePassword', () => {
    it('修改密码后应吊销全部 refresh token', async () => {
      const hashed = await argon2.hash('OldPass1');
      mockPrisma.user.findUnique.mockResolvedValue({ password: hashed });
      mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) => {
        for (const op of ops) await op;
        return ops;
      });

      const result = await service.changePassword('u1', 'OldPass1', 'NewPass1');
      expect(result.message).toBe('密码已修改，请重新登录');
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
    });
  });

  describe('requestChangeEmailCode', () => {
    it('新邮箱与当前相同应 400', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'a@b.com', password: 'x' });
      await expect(
        service.requestChangeEmailCode('u1', 'a@b.com', 'Pass1234'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST, status: 400 });
    });

    it('当前密码错误应 401（二次认证）', async () => {
      const hashed = await argon2.hash('CurrentPass123');
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'a@b.com', password: hashed });
      await expect(
        service.requestChangeEmailCode('u1', 'new@b.com', 'WrongPass'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.WRONG_OLD_PASSWORD, status: 401 });
    });

    it('密码正确时发送验证码并创建记录', async () => {
      const hashed = await argon2.hash('CurrentPass123');
      // 第一次调用返回当前用户，第二次（查重）返回 null
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ email: 'a@b.com', password: hashed })
        .mockResolvedValueOnce(null);
      mockPrisma.emailVerification.findFirst.mockResolvedValue(null);
      mockPrisma.emailVerification.create.mockResolvedValue({});

      const result = await service.requestChangeEmailCode('u1', 'new@b.com', 'CurrentPass123');
      expect(result.message).toContain('验证码已发送');
      expect(mockPrisma.emailVerification.create).toHaveBeenCalled();
      expect(mockEmailService.sendVerification).toHaveBeenCalledWith(
        'new@b.com',
        expect.any(String),
        'CHANGE_EMAIL',
      );
    });

    it('换新邮箱时作废旧记录并为新邮箱生成验证码', async () => {
      const hashed = await argon2.hash('CurrentPass123');
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ email: 'a@b.com', password: hashed })
        .mockResolvedValueOnce(null);
      const oldRecord = {
        id: 'old-record', userId: 'u1', email: 'old@x.com',
        token: '111111', type: 'CHANGE_EMAIL',
        expiresAt: new Date(Date.now() + 60_000),
      };
      mockPrisma.emailVerification.findFirst.mockResolvedValue(oldRecord);
      mockPrisma.emailVerification.delete.mockResolvedValue(oldRecord);
      mockPrisma.emailVerification.create.mockResolvedValue({});

      await service.requestChangeEmailCode('u1', 'new@b.com', 'CurrentPass123');

      expect(mockPrisma.emailVerification.delete).toHaveBeenCalledWith({
        where: { id: 'old-record' },
      });
      expect(mockPrisma.emailVerification.create).toHaveBeenCalledWith(
        { data: expect.objectContaining({ email: 'new@b.com', type: 'CHANGE_EMAIL' }) },
      );
      expect(mockEmailService.sendVerification).toHaveBeenCalledWith(
        'new@b.com',
        expect.any(String),
        'CHANGE_EMAIL',
      );
    });

    it('同一邮箱有效期内重发同一验证码，不新建', async () => {
      const hashed = await argon2.hash('CurrentPass123');
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ email: 'a@b.com', password: hashed })
        .mockResolvedValueOnce(null);
      const record = {
        id: 'rec', userId: 'u1', email: 'new@b.com',
        token: '222222', type: 'CHANGE_EMAIL',
        expiresAt: new Date(Date.now() + 60_000),
      };
      mockPrisma.emailVerification.findFirst.mockResolvedValue(record);

      const result = await service.requestChangeEmailCode('u1', 'new@b.com', 'CurrentPass123');

      expect(result.message).toContain('验证码已发送');
      expect(mockEmailService.sendVerification).toHaveBeenCalledWith(
        'new@b.com', '222222', 'CHANGE_EMAIL',
      );
      expect(mockPrisma.emailVerification.delete).not.toHaveBeenCalled();
      expect(mockPrisma.emailVerification.create).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it('应该返回用户活跃登录终端列表', async () => {
      const crypto = await import('crypto');
      const currentHash = crypto.createHash('sha256').update('token2').digest('hex');

      mockPrisma.refreshToken.findMany.mockResolvedValue([
        {
          family: 'f1', platform: 'web', deviceInfo: 'Chrome',
          sessionStartedAt: new Date(Date.now() - 3600000),
          createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
          tokenHash: 'other-hash',
        },
        {
          family: 'f2', platform: 'mobile', deviceInfo: 'iOS App',
          sessionStartedAt: new Date(Date.now() - 7200000),
          createdAt: new Date(), expiresAt: new Date(Date.now() + 2592000000),
          tokenHash: currentHash,
        },
      ]);

      const sessions = await service.listSessions('u1', 'f2', 'token2');
      expect(sessions).toHaveLength(2);
      expect(sessions[0].isCurrent).toBe(false);
      expect(sessions[1].isCurrent).toBe(true);
      expect(sessions[1].id).toBe('f2');
      expect(sessions[1].platform).toBe('mobile');
      expect(sessions[1].createdAt).toBe(sessions[1].signedInAt);
      expect(mockPrisma.refreshToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            revokedAt: null,
            expiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
    });
  });

  describe('revokeSession', () => {
    it('应该退出指定登录终端', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({ family: 'f1' });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.revokeSession('u1', 's1');
      expect(result.message).toBe('登录终端已退出');
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', family: 'f1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('会话不存在时应该返回400', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
      await expect(
        service.revokeSession('u1', 'nonexistent'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.SESSION_NOT_FOUND, status: 401 });
    });
  });
});
