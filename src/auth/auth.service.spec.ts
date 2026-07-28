import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
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
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
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
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
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
      ).rejects.toThrow(ConflictException);
    });

    it('无验证记录时应该创建新记录并发送验证码', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.emailVerification.findFirst.mockResolvedValue(null);

      const result = await service.requestCode('a@b.com');

      expect(mockPrisma.emailVerification.create).toHaveBeenCalled();
      expect(result.emailSent).toBe(true);
      expect(result.codeExpiresIn).toBe(900);
    });

    it('验证码未过期时不重发', async () => {
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
      ).rejects.toThrow(BadRequestException);
    });

    it('验证码错误时应该返回401并增加尝试计数', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.emailVerification.findFirst.mockResolvedValue({
        id: 'ev1', email: 'a@b.com', token: '999999',
        type: 'REGISTRATION', expiresAt: future, attempts: 0, createdAt: new Date(),
      });

      await expect(
        service.verifyAndComplete(validDto),
      ).rejects.toThrow(UnauthorizedException);
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
      ).rejects.toThrow(UnauthorizedException);
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
      ).rejects.toThrow(UnauthorizedException);
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
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('正确密码应该能登录', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', password: hashed, username: 'test', avatar: null,
        role: 'USER', emailVerified: false, deletedAt: null,
      });
      mockJwt.signAsync.mockResolvedValue('at-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      const result = await service.login({ email: 'a@b.com', password: 'Test1234!' });
      expect(result.accessToken).toBe('at-token');
      expect(result.user.email).toBe('a@b.com');
      expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
    });

    it('密码错误应该返回401', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', password: hashed, deletedAt: null,
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('用户不存在时登录应该返回401', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'a@b.com', password: 'Test1234!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('已注销用户登录应该返回401', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', password: hashed, deletedAt: new Date(),
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'Test1234!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('邮箱大小写不敏感', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'user@case.com', password: hashed, username: 'test', avatar: null,
        role: 'USER', emailVerified: false, deletedAt: null,
      });
      mockJwt.signAsync.mockResolvedValue('at-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      await service.login({ email: 'USER@CASE.COM', password: 'Test1234!' });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'user@case.com' } }),
      );
    });

    it('移动端登录应使用 30 天 TTL', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', password: hashed, username: 'test', avatar: null,
        role: 'USER', emailVerified: false, deletedAt: null,
      });
      mockJwt.signAsync.mockResolvedValue('at-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      await service.login({ email: 'a@b.com', password: 'Test1234!' }, undefined, 'mobile');
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
        revokedAt: null, createdAt: new Date(),
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
      await expect(service.refresh('bad-rt')).rejects.toThrow(UnauthorizedException);
    });

    it('refresh token 已撤销时应吊销整个 family', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt1', userId: 'u1', tokenHash: expect.any(String), family: 'f1',
        deviceInfo: null, expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(), createdAt: new Date(),
        user: { deletedAt: null },
      });

      await expect(service.refresh('stolen-rt')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { family: 'f1' } }),
      );
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
      mockPrisma.$transaction.mockImplementation(async (ops: any[]) => {
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

  describe('listSessions', () => {
    it('应该返回用户活跃会话列表', async () => {
      const crypto = await import('crypto');
      const currentHash = crypto.createHash('sha256').update('token2').digest('hex');

      mockPrisma.refreshToken.findMany.mockResolvedValue([
        {
          id: 's1', platform: 'web', deviceInfo: 'Chrome',
          createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000),
          tokenHash: 'other-hash',
        },
        {
          id: 's2', platform: 'mobile', deviceInfo: 'iOS App',
          createdAt: new Date(), expiresAt: new Date(Date.now() + 2592000000),
          tokenHash: currentHash,
        },
      ]);

      const sessions = await service.listSessions('u1', 'token2');
      expect(sessions).toHaveLength(2);
      expect(sessions[0].isCurrent).toBe(false);
      expect(sessions[1].isCurrent).toBe(true);
      expect(sessions[1].platform).toBe('mobile');
    });
  });

  describe('revokeSession', () => {
    it('应该撤销指定会话', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await service.revokeSession('u1', 's1');
      expect(result.message).toBe('已撤销');
    });

    it('会话不存在时应该返回400', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.revokeSession('u1', 'nonexistent'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
