import { ConfigService } from '@nestjs/config';
import { AdminInviteStatus, AuditAction, UserRole } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { EmailService } from '../email/email.service';
import { AuditService } from '../moderation/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccountsService } from './admin-accounts.service';

describe('AdminAccountsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    user: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    adminInvite: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    adminSession: { updateMany: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
  };
  const config = { get: jest.fn() };
  const email = { sendAdminInvite: jest.fn() };
  const audit = { record: jest.fn() };
  const actor = { id: 'super-1', username: 'root', role: UserRole.SUPER_ADMIN };
  const context = { requestId: 'request-1', ip: '127.0.0.1' };
  let service: AdminAccountsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: typeof prisma) => Promise<unknown>)(prisma);
    });
    config.get.mockImplementation(
      (key: string) =>
        ({
          'app.adminWebEntryUrl': 'https://admin.example.test/invite',
          'app.webUrl': 'https://web.example.test',
        })[key],
    );
    email.sendAdminInvite.mockResolvedValue(undefined);
    audit.record.mockResolvedValue(undefined);
    prisma.adminSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    service = new AdminAccountsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      email as unknown as EmailService,
      audit as unknown as AuditService,
    );
  });

  it('原子返回管理员账号和待处理邀请', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
    prisma.adminInvite.findMany.mockResolvedValue([{ id: 'invite-1' }]);

    await expect(service.list()).resolves.toEqual({
      accounts: [{ id: 'admin-1' }],
      invites: [{ id: 'invite-1' }],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
  });

  it('邀请普通用户时事务写审计，提交后才发送邮件', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.test',
      username: 'user',
      role: UserRole.USER,
      deletedAt: null,
    });
    prisma.adminInvite.create.mockResolvedValue({
      id: 'invite-1',
      expiresAt: new Date('2026-08-23T00:00:00Z'),
      user: { email: 'user@example.test' },
    });

    await expect(service.invite(actor, 'user-1', context)).resolves.toEqual({
      id: 'invite-1',
      expiresAt: new Date('2026-08-23T00:00:00Z'),
    });
    expect(prisma.adminInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', invitedById: 'super-1' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ADMIN_INVITED, targetId: 'invite-1' }),
      prisma,
    );
    expect(email.sendAdminInvite).toHaveBeenCalledWith(
      'user@example.test',
      expect.stringMatching(/^https:\/\/admin\.example\.test\/invite\?token=/),
    );
  });

  it('拒绝不存在、已删除或已有管理身份的目标', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.invite(actor, 'missing', context)).rejects.toMatchObject({
      errorCode: ErrorCode.USER_NOT_FOUND,
    });
    prisma.user.findUnique.mockResolvedValueOnce({ deletedAt: new Date(), role: UserRole.USER });
    await expect(service.invite(actor, 'deleted', context)).rejects.toMatchObject({
      errorCode: ErrorCode.USER_NOT_FOUND,
    });
    prisma.user.findUnique.mockResolvedValueOnce({ deletedAt: null, role: UserRole.ADMIN });
    await expect(service.invite(actor, 'admin-1', context)).rejects.toMatchObject({
      errorCode: ErrorCode.ADMIN_INVITE_CONFLICT,
    });
  });

  it('并发邀请唯一键冲突转换为稳定业务冲突', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.test',
      role: UserRole.USER,
      deletedAt: null,
    });
    prisma.$transaction.mockRejectedValue({ code: 'P2002' });

    await expect(service.invite(actor, 'user-1', context)).rejects.toMatchObject({
      errorCode: ErrorCode.ADMIN_INVITE_CONFLICT,
    });
    expect(email.sendAdminInvite).not.toHaveBeenCalled();
  });

  it('接受有效邀请时提升角色并撤销普通登录终端', async () => {
    prisma.adminInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      userId: 'user-1',
      status: AdminInviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      user: { role: UserRole.USER, deletedAt: null },
    });
    prisma.user.update.mockResolvedValue({});
    prisma.adminInvite.update.mockResolvedValue({});

    await expect(service.accept('raw-token', 'user-1')).resolves.toEqual({
      message: '邀请已接受，请从站务台重新登录',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: UserRole.ADMIN },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', revokedAt: null },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ADMIN_INVITE_ACCEPTED }),
      prisma,
    );
  });

  it('过期邀请先原子标记 EXPIRED 再返回冲突', async () => {
    prisma.adminInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      userId: 'user-1',
      status: AdminInviteStatus.PENDING,
      expiresAt: new Date(Date.now() - 1),
      user: { role: UserRole.USER, deletedAt: null },
    });

    await expect(service.accept('expired', 'user-1')).rejects.toMatchObject({
      errorCode: ErrorCode.ADMIN_INVITE_CONFLICT,
    });
    expect(prisma.adminInvite.update).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: { status: AdminInviteStatus.EXPIRED },
    });
  });

  it('邀请不存在、归属错误或账号状态变化时拒绝接受', async () => {
    prisma.adminInvite.findUnique.mockResolvedValueOnce(null);
    await expect(service.accept('missing', 'user-1')).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    prisma.adminInvite.findUnique.mockResolvedValueOnce({
      id: 'invite-1',
      userId: 'other',
      status: AdminInviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      user: { role: UserRole.USER, deletedAt: null },
    });
    await expect(service.accept('wrong-owner', 'user-1')).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    prisma.adminInvite.findUnique.mockResolvedValueOnce({
      id: 'invite-1',
      userId: 'user-1',
      status: AdminInviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      user: { role: UserRole.ADMIN, deletedAt: null },
    });
    await expect(service.accept('changed', 'user-1')).rejects.toMatchObject({
      errorCode: ErrorCode.ADMIN_INVITE_CONFLICT,
    });
  });

  it('取消待处理邀请并记录经裁剪的理由', async () => {
    prisma.adminInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      status: AdminInviteStatus.PENDING,
    });
    prisma.adminInvite.update.mockResolvedValue({});

    await expect(service.cancel(actor, 'invite-1', '  重复邀请  ', context)).resolves.toEqual({
      message: '邀请已取消',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ADMIN_INVITE_CANCELED, reason: '重复邀请' }),
      prisma,
    );
  });

  it('拒绝取消不存在或已处理的邀请', async () => {
    prisma.adminInvite.findUnique.mockResolvedValueOnce(null);
    await expect(service.cancel(actor, 'missing', '原因', context)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    prisma.adminInvite.findUnique.mockResolvedValueOnce({ status: AdminInviteStatus.ACCEPTED });
    await expect(service.cancel(actor, 'done', '原因', context)).rejects.toMatchObject({
      errorCode: ErrorCode.ADMIN_INVITE_CONFLICT,
    });
  });

  it('撤销普通管理员时同时撤销站务与普通终端', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });
    prisma.user.update.mockResolvedValue({});

    await expect(service.revoke(actor, 'admin-1', '  权限调整  ', context)).resolves.toEqual({
      message: '管理员身份已撤销',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: { role: UserRole.USER },
    });
    expect(prisma.adminSession.updateMany).toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ADMIN_ROLE_REVOKED, reason: '权限调整' }),
      prisma,
    );
  });

  it('禁止撤销自己、缺失用户和非普通管理员', async () => {
    await expect(service.revoke(actor, actor.id, '原因', context)).rejects.toMatchObject({
      errorCode: ErrorCode.CANNOT_MODERATE_ADMIN,
    });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.revoke(actor, 'missing', '原因', context)).rejects.toMatchObject({
      errorCode: ErrorCode.USER_NOT_FOUND,
    });
    prisma.user.findUnique.mockResolvedValueOnce({ role: UserRole.USER });
    await expect(service.revoke(actor, 'user-1', '原因', context)).rejects.toMatchObject({
      errorCode: ErrorCode.ADMIN_INVITE_CONFLICT,
    });
  });

  it('移交超级管理员时交换角色并撤销双方全部终端', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });
    prisma.user.update.mockResolvedValue({});

    await expect(
      service.transferSuperAdmin(actor, 'admin-1', '  交接  ', context),
    ).resolves.toEqual({ message: '超级管理员已移交，双方需要重新登录站务台' });
    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: actor.id },
      data: { role: UserRole.ADMIN },
    });
    expect(prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'admin-1' },
      data: { role: UserRole.SUPER_ADMIN },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.SUPER_ADMIN_TRANSFERRED, reason: '交接' }),
      prisma,
    );
  });

  it('拒绝向自己、缺失用户或非管理员移交', async () => {
    await expect(
      service.transferSuperAdmin(actor, actor.id, '原因', context),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.CONFLICT,
    });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.transferSuperAdmin(actor, 'missing', '原因', context),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.USER_NOT_FOUND,
    });
    prisma.user.findUnique.mockResolvedValueOnce({ role: UserRole.USER });
    await expect(
      service.transferSuperAdmin(actor, 'user-1', '原因', context),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.CONFLICT,
    });
  });
});
