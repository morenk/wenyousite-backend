import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
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

  it('应该能注册新用户并返回双Token', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'u1', email: 'a@b.com', username: 'test', nickname: 'test', avatar: null, role: 'USER',
    });
    mockJwt.signAsync
      .mockResolvedValueOnce('at-token')
      .mockResolvedValueOnce('rt-token');

    const result = await service.register({ email: 'a@b.com', username: 'test', password: 'Test1234!' });

    expect(result.accessToken).toBe('at-token');
    expect(result.refreshToken).toBe('rt-token');
    expect(result.user.email).toBe('a@b.com');
    expect(result.user.username).toBe('test');
  });

  it('邮箱已注册时应该返回409冲突', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'x' });
    await expect(
      service.register({ email: 'a@b.com', username: 'test', password: 'Test1234!' }),
    ).rejects.toThrow(ConflictException);
  });

  it('用户名已存在时应该返回409冲突', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null)  // email ok
      .mockResolvedValueOnce({ id: 'x' });  // username conflict
    await expect(
      service.register({ email: 'a@b.com', username: 'test', password: 'Test1234!' }),
    ).rejects.toThrow(ConflictException);
  });

  it('正确密码应该能登录', async () => {
    const hashed = await argon2.hash('Test1234!');
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@b.com', password: hashed, username: 'test', nickname: 'test', avatar: null, role: 'USER',
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
      id: 'u1', email: 'a@b.com', password: hashed,
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

  it('refresh token 有效时应该返回新Token', async () => {
    mockJwt.verify.mockReturnValue({ sub: 'u1' });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@b.com', username: 'test', nickname: 'test', avatar: null, role: 'USER',
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
