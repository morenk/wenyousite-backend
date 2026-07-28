import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  emailVerification: {
    create: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  registrationDraft: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockJwt = { signAsync: jest.fn(), verify: jest.fn() };
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

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EmailService, useValue: { sendVerification: jest.fn().mockResolvedValue(undefined), sendPasswordReset: jest.fn().mockResolvedValue(undefined) } },
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

    it('无草稿时应该创建新草稿并发送验证码', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.registrationDraft.findUnique.mockResolvedValue(null);

      const result = await service.requestCode('a@b.com');

      expect(mockPrisma.registrationDraft.create).toHaveBeenCalled();
      expect(result.sent).toBe(true);
      expect(result.codeExpiresIn).toBeGreaterThan(0);
    });

    it('验证码未过期时不应重发', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.registrationDraft.findUnique.mockResolvedValue({
        id: 'd1', email: 'a@b.com', verificationCode: '123456',
        codeExpiresAt: future, createdAt: new Date(),
      });

      const result = await service.requestCode('a@b.com');

      expect(result.sent).toBe(false);
      expect(mockPrisma.registrationDraft.create).not.toHaveBeenCalled();
    });

    it('验证码已过期但草稿未超时应该更新验证码并重发', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const past = new Date(Date.now() - 5 * 60 * 1000);
      mockPrisma.registrationDraft.findUnique.mockResolvedValue({
        id: 'd1', email: 'a@b.com', verificationCode: '654321',
        codeExpiresAt: past, createdAt: new Date(Date.now() - 20 * 60 * 1000),
      });

      const result = await service.requestCode('a@b.com');

      expect(mockPrisma.registrationDraft.update).toHaveBeenCalled();
      expect(result.sent).toBe(true);
    });

    it('草稿超过1小时应该删除旧草稿并新建', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
      mockPrisma.registrationDraft.findUnique.mockResolvedValue({
        id: 'd1', email: 'a@b.com', verificationCode: '111111',
        codeExpiresAt: oldDate, createdAt: oldDate,
      });

      await service.requestCode('a@b.com');

      expect(mockPrisma.registrationDraft.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
      expect(mockPrisma.registrationDraft.create).toHaveBeenCalled();
    });
  });

  describe('verifyAndComplete', () => {
    it('无草稿时应该返回400', async () => {
      mockPrisma.registrationDraft.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyAndComplete({ email: 'a@b.com', code: '123456', username: 'test', password: 'Test1234!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('验证码错误时应该返回401', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.registrationDraft.findUnique.mockResolvedValue({
        id: 'd1', email: 'a@b.com', verificationCode: '999999',
        codeExpiresAt: future, createdAt: new Date(),
      });

      await expect(
        service.verifyAndComplete({ email: 'a@b.com', code: '123456', username: 'test', password: 'Test1234!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('验证码过期时应该返回401', async () => {
      const past = new Date(Date.now() - 5 * 60 * 1000);
      mockPrisma.registrationDraft.findUnique.mockResolvedValue({
        id: 'd1', email: 'a@b.com', verificationCode: '123456',
        codeExpiresAt: past, createdAt: new Date(Date.now() - 20 * 60 * 1000),
      });

      await expect(
        service.verifyAndComplete({ email: 'a@b.com', code: '123456', username: 'test', password: 'Test1234!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('验证通过应该创建用户并返回Token', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.registrationDraft.findUnique.mockResolvedValue({
        id: 'd1', email: 'a@b.com', verificationCode: '123456',
        codeExpiresAt: future, createdAt: new Date(),
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u1', email: 'a@b.com', username: 'test', nickname: 'test', avatar: null, role: 'USER',
        emailVerified: true,
      });
      mockJwt.signAsync
        .mockResolvedValueOnce('at-token')
        .mockResolvedValueOnce('rt-token');

      const result = await service.verifyAndComplete({
        email: 'a@b.com', code: '123456', username: 'test', password: 'Test1234!',
      });

      expect(result.accessToken).toBe('at-token');
      expect(result.user.email).toBe('a@b.com');
      expect(result.user.emailVerified).toBe(true);
      expect(mockPrisma.registrationDraft.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
    });

    it('用户名已被占用时应该返回409', async () => {
      const future = new Date(Date.now() + 10 * 60 * 1000);
      mockPrisma.registrationDraft.findUnique.mockResolvedValue({
        id: 'd1', email: 'a@b.com', verificationCode: '123456',
        codeExpiresAt: future, createdAt: new Date(),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'x' });

      await expect(
        service.verifyAndComplete({ email: 'a@b.com', code: '123456', username: 'test', password: 'Test1234!' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('正确密码应该能登录', async () => {
      const hashed = await argon2.hash('Test1234!');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', password: hashed, username: 'test', nickname: 'test', avatar: null, role: 'USER',
        emailVerified: true, tokenVersion: 0, deletedAt: null,
      });
      mockJwt.signAsync
        .mockResolvedValueOnce('at-token')
        .mockResolvedValueOnce('rt-token');

      const result = await service.login({ email: 'a@b.com', password: 'Test1234!' });
      expect(result.accessToken).toBe('at-token');
      expect(result.user.email).toBe('a@b.com');
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
  });

  describe('refresh', () => {
    it('refresh token 有效时应该返回新Token', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'u1', tv: 0 });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'a@b.com', username: 'test', nickname: 'test', avatar: null, role: 'USER',
        emailVerified: true, tokenVersion: 0, deletedAt: null,
      });
      mockJwt.signAsync
        .mockResolvedValueOnce('new-at')
        .mockResolvedValueOnce('new-rt');

      const result = await service.refresh('valid-rt');
      expect(result.accessToken).toBe('new-at');
    });

    it('refresh token 无效时应该返回401', async () => {
      mockJwt.verify.mockImplementation(() => { throw new Error('invalid'); });
      await expect(service.refresh('bad-rt')).rejects.toThrow(UnauthorizedException);
    });
  });
});
