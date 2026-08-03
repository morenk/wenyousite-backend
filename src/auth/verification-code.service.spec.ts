/** VerificationCodeService 测试：生成/复用/重发/作废/P2002 并发 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationCodeService } from './verification-code.service';
import { Prisma } from '@prisma/client';

const mockPrisma = {
  emailVerification: {
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
};

describe('VerificationCodeService', () => {
  let service: VerificationCodeService;
  const send = jest.fn().mockResolvedValue(undefined);
  const record = (over: Partial<any> = {}) => ({
    id: 'ev1',
    userId: null,
    email: 'a@b.com',
    token: '123456',
    type: 'REGISTRATION',
    expiresAt: new Date(Date.now() + 60000),
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [VerificationCodeService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<VerificationCodeService>(VerificationCodeService);
  });

  it('无记录时生成新验证码并发送', async () => {
    mockPrisma.emailVerification.findFirst.mockResolvedValue(null);
    mockPrisma.emailVerification.create.mockResolvedValue({});

    const result = await service.issue({
      type: 'REGISTRATION', email: 'a@b.com', label: '注册', send,
    });

    expect(result.resent).toBe(false);
    expect(send).toHaveBeenCalledWith(expect.any(String));
    expect(mockPrisma.emailVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'a@b.com', type: 'REGISTRATION' }),
    });
  });

  it('有效记录默认复用并重发同一验证码', async () => {
    mockPrisma.emailVerification.findFirst.mockResolvedValue(record());

    const result = await service.issue({
      type: 'REGISTRATION', email: 'a@b.com', label: '注册', send,
    });

    expect(result.resent).toBe(true);
    expect(result.code).toBe('123456');
    expect(send).toHaveBeenCalledWith('123456');
    expect(mockPrisma.emailVerification.create).not.toHaveBeenCalled();
  });

  it('resendIfSameEmail 时仅同一邮箱才复用', async () => {
    // 不同邮箱 → 作废旧记录并为新邮箱新建
    mockPrisma.emailVerification.findFirst.mockResolvedValue(record({ email: 'old@x.com' }));
    mockPrisma.emailVerification.create.mockResolvedValue({});

    const result = await service.issue({
      type: 'CHANGE_EMAIL', userId: 'u1', email: 'new@b.com', resendIfSameEmail: true, label: '换邮箱', send,
    });

    expect(result.resent).toBe(false);
    expect(mockPrisma.emailVerification.delete).toHaveBeenCalledWith({ where: { id: 'ev1' } });
    expect(mockPrisma.emailVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'new@b.com', type: 'CHANGE_EMAIL' }),
    });

    // 同一邮箱 → 复用
    mockPrisma.emailVerification.findFirst.mockResolvedValue(record({ email: 'new@b.com', token: '222222' }));
    const r2 = await service.issue({
      type: 'CHANGE_EMAIL', userId: 'u1', email: 'new@b.com', resendIfSameEmail: true, label: '换邮箱', send,
    });
    expect(r2.resent).toBe(true);
    expect(send).toHaveBeenLastCalledWith('222222');
  });

  it('已过期记录作废并新建', async () => {
    mockPrisma.emailVerification.findFirst.mockResolvedValue(
      record({ expiresAt: new Date(Date.now() - 1000) }),
    );
    mockPrisma.emailVerification.create.mockResolvedValue({});

    const result = await service.issue({
      type: 'REGISTRATION', email: 'a@b.com', label: '注册', send,
    });

    expect(result.resent).toBe(false);
    expect(mockPrisma.emailVerification.delete).toHaveBeenCalledWith({ where: { id: 'ev1' } });
    expect(mockPrisma.emailVerification.create).toHaveBeenCalled();
  });

  it('P2002 并发时复用已存在的验证码', async () => {
    mockPrisma.emailVerification.findFirst
      .mockResolvedValueOnce(null) // 首次查找
      .mockResolvedValueOnce(record({ token: '888888' })); // P2002 后回查
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
    mockPrisma.emailVerification.create.mockRejectedValue(p2002);

    const result = await service.issue({
      type: 'REGISTRATION', email: 'a@b.com', label: '注册', send,
    });

    expect(result.resent).toBe(true);
    expect(result.code).toBe('888888');
    expect(send).toHaveBeenCalledWith('888888');
  });
});
