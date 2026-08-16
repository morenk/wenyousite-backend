/** VerificationCodeService 测试：生成/复用/投递冷却/作废/P2002 并发 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationCodeService } from './verification-code.service';
import { Prisma } from '@prisma/client';

const mockPrisma = {
  emailVerification: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
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
    lastSendAttemptAt: null,
    lastSentAt: null,
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [VerificationCodeService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<VerificationCodeService>(VerificationCodeService);
    mockPrisma.emailVerification.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'ev-created', ...data }),
    );
    mockPrisma.emailVerification.updateMany.mockResolvedValue({ count: 1 });
  });

  it('生成固定六位数字且不依赖 Math.random', () => {
    const random = jest.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('security code must not use Math.random');
    });

    expect(service.generateCode()).toMatch(/^\d{6}$/);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('无记录时生成新验证码并发送', async () => {
    mockPrisma.emailVerification.findFirst.mockResolvedValue(null);
    const result = await service.issue({
      type: 'REGISTRATION',
      email: 'a@b.com',
      label: '注册',
      send,
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
      type: 'REGISTRATION',
      email: 'a@b.com',
      label: '注册',
      send,
    });

    expect(result.resent).toBe(true);
    expect(result.code).toBe('123456');
    expect(send).toHaveBeenCalledWith('123456');
    expect(mockPrisma.emailVerification.create).not.toHaveBeenCalled();
  });

  it('resendIfSameEmail 时仅同一邮箱才复用', async () => {
    // 不同邮箱 → 作废旧记录并为新邮箱新建
    mockPrisma.emailVerification.findFirst.mockResolvedValue(record({ email: 'old@x.com' }));
    const result = await service.issue({
      type: 'CHANGE_EMAIL',
      userId: 'u1',
      email: 'new@b.com',
      resendIfSameEmail: true,
      label: '换邮箱',
      send,
    });

    expect(result.resent).toBe(false);
    expect(mockPrisma.emailVerification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'ev1' },
    });
    expect(mockPrisma.emailVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'new@b.com', type: 'CHANGE_EMAIL' }),
    });

    // 同一邮箱 → 复用
    mockPrisma.emailVerification.findFirst.mockResolvedValue(
      record({ email: 'new@b.com', token: '222222' }),
    );
    const r2 = await service.issue({
      type: 'CHANGE_EMAIL',
      userId: 'u1',
      email: 'new@b.com',
      resendIfSameEmail: true,
      label: '换邮箱',
      send,
    });
    expect(r2.resent).toBe(true);
    expect(send).toHaveBeenLastCalledWith('222222');
  });

  it('已过期记录作废并新建', async () => {
    mockPrisma.emailVerification.findFirst.mockResolvedValue(
      record({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const result = await service.issue({
      type: 'REGISTRATION',
      email: 'a@b.com',
      label: '注册',
      send,
    });

    expect(result.resent).toBe(false);
    expect(mockPrisma.emailVerification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'ev1' },
    });
    expect(mockPrisma.emailVerification.create).toHaveBeenCalled();
  });

  it('P2002 并发时复用胜出请求的发送占位且不重复投递', async () => {
    const attemptAt = new Date();
    const existing = record({ token: '888888', lastSendAttemptAt: attemptAt });
    mockPrisma.emailVerification.findFirst
      .mockResolvedValueOnce(null) // 首次查找
      .mockResolvedValueOnce(existing); // P2002 后回查
    mockPrisma.emailVerification.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.emailVerification.findUnique.mockResolvedValue(existing);
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    mockPrisma.emailVerification.create.mockRejectedValue(p2002);

    const result = await service.issue({
      type: 'REGISTRATION',
      email: 'a@b.com',
      label: '注册',
      send,
    });

    expect(result.resent).toBe(true);
    expect(result.code).toBe('888888');
    expect(result.emailSent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('60 秒冷却期内复用已确认的投递结果且不重复发送', async () => {
    const attemptAt = new Date();
    const existing = record({
      lastSendAttemptAt: attemptAt,
      lastSentAt: attemptAt,
    });
    mockPrisma.emailVerification.findFirst.mockResolvedValue(existing);
    mockPrisma.emailVerification.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.emailVerification.findUnique.mockResolvedValue(existing);

    const result = await service.issue({
      type: 'REGISTRATION',
      email: 'a@b.com',
      label: '注册',
      send,
    });

    expect(result.emailSent).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('发送失败后仍保留冷却占位，下一请求不会立即重发', async () => {
    mockPrisma.emailVerification.findFirst.mockResolvedValueOnce(null);
    send.mockRejectedValueOnce(new Error('smtp unavailable'));

    const first = await service.issue({
      type: 'REGISTRATION',
      email: 'a@b.com',
      label: '注册',
      send,
    });
    expect(first.emailSent).toBe(false);

    const attemptAt = (
      mockPrisma.emailVerification.create.mock.calls[0][0].data as {
        lastSendAttemptAt: Date;
      }
    ).lastSendAttemptAt;
    const existing = record({ lastSendAttemptAt: attemptAt });
    mockPrisma.emailVerification.findFirst.mockResolvedValueOnce(existing);
    mockPrisma.emailVerification.updateMany.mockResolvedValueOnce({ count: 0 });
    mockPrisma.emailVerification.findUnique.mockResolvedValue(existing);

    const second = await service.issue({
      type: 'REGISTRATION',
      email: 'a@b.com',
      label: '注册',
      send,
    });

    expect(second.emailSent).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('交互事务内的 P2002 交给外层处理，不在已中止事务上继续查询', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const tx = {
      emailVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(p2002),
        deleteMany: jest.fn(),
      },
    };

    await expect(
      service.prepareInTransaction(
        {
          type: 'CHANGE_EMAIL',
          userId: 'u1',
          email: 'new@b.com',
        },
        tx as never,
      ),
    ).rejects.toBe(p2002);
    expect(tx.emailVerification.findFirst).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('邮件发送失败日志不包含邮箱或底层错误详情', async () => {
    const loggerError = jest
      .spyOn(
        (service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    mockPrisma.emailVerification.findFirst.mockResolvedValue(null);
    mockPrisma.emailVerification.create.mockResolvedValue({ id: 'ev-created' });
    send.mockRejectedValueOnce(new Error('SMTP rejected a@b.com'));

    await expect(
      service.issue({
        type: 'REGISTRATION',
        email: 'a@b.com',
        label: '注册验证码',
        send,
      }),
    ).resolves.toEqual(expect.objectContaining({ emailSent: false }));

    expect(loggerError).toHaveBeenCalledWith('注册验证码发送失败');
  });
});
