import { ReportReasonCode, ReportStatus, ReportTargetType, UserRole } from '@prisma/client';
import { AuditService } from '../admin/audit.service';
import { ModerationService } from '../admin/moderation.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    report: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    thread: { findFirst: jest.fn(), findUnique: jest.fn() },
    post: { findFirst: jest.fn(), findUnique: jest.fn() },
  };
  const moderation = {
    hideContentInTransaction: jest.fn(),
    applySanctionInTransaction: jest.fn(),
    finalizeContentMutation: jest.fn(),
    finalizeUserMutation: jest.fn(),
  };
  const audit = { record: jest.fn() };
  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );
    audit.record.mockResolvedValue({});
    service = new ReportsService(
      prisma as unknown as PrismaService,
      moderation as unknown as ModerationService,
      audit as unknown as AuditService,
    );
  });

  it('创建用户举报时保存脱敏目标快照', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'cm1234567890123456789012',
      username: 'target',
      avatar: null,
      role: UserRole.USER,
    });
    prisma.report.create.mockImplementation(async ({ data }) => ({ id: 'report-1', ...data }));

    const result = await service.create('cm2234567890123456789012', {
      targetType: ReportTargetType.USER,
      targetId: 'cm1234567890123456789012',
      reasonCode: ReportReasonCode.HARASSMENT,
      details: '持续骚扰',
    });

    expect(result.targetSnapshot).toEqual(
      expect.objectContaining({
        snapshotVersion: 1,
        targetType: ReportTargetType.USER,
        user: expect.objectContaining({ username: 'target' }),
      }),
    );
    expect(JSON.stringify(result.targetSnapshot)).not.toContain('email');
  });

  it('拒绝举报自己', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'cm1234567890123456789012',
      username: 'self',
      avatar: null,
      role: UserRole.USER,
    });
    await expect(
      service.create('cm1234567890123456789012', {
        targetType: ReportTargetType.USER,
        targetId: 'cm1234567890123456789012',
        reasonCode: ReportReasonCode.OTHER,
        details: '测试',
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
  });

  it('重复待处理举报转换为稳定冲突码', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'cm1234567890123456789012',
      username: 'target',
      avatar: null,
      role: UserRole.USER,
    });
    prisma.report.create.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.create('cm2234567890123456789012', {
        targetType: ReportTargetType.USER,
        targetId: 'cm1234567890123456789012',
        reasonCode: ReportReasonCode.SPAM,
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.REPORT_ALREADY_PENDING });
  });

  it('驳回举报时原子更新状态并写审计', async () => {
    const pending = {
      id: 'report-1',
      status: ReportStatus.PENDING,
      targetType: ReportTargetType.POST,
      targetId: 'post-1',
    };
    prisma.report.findUnique.mockResolvedValue(pending);
    prisma.report.updateMany.mockResolvedValue({ count: 1 });
    prisma.report.findUniqueOrThrow.mockResolvedValue({
      ...pending,
      status: ReportStatus.DISMISSED,
      reporter: null,
      handler: null,
    });
    prisma.post.findUnique.mockResolvedValue({ deletedAt: null, removalSource: null });

    await expect(
      service.resolve(
        'report-1',
        { id: 'admin-1', username: 'admin', role: UserRole.ADMIN },
        { outcome: 'DISMISSED', note: '证据不足', action: 'NONE' },
        { requestId: 'request-1' },
      ),
    ).resolves.toMatchObject({ status: ReportStatus.DISMISSED });

    expect(prisma.report.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'report-1', status: ReportStatus.PENDING },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REPORT_DISMISSED',
        reportId: 'report-1',
      }),
      prisma,
    );
  });

  it('并发或重复结案返回 REPORT_ALREADY_HANDLED', async () => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'report-1',
      status: ReportStatus.RESOLVED,
      targetType: ReportTargetType.USER,
      targetId: 'user-1',
    });
    await expect(
      service.resolve(
        'report-1',
        { id: 'admin-1', role: UserRole.ADMIN },
        { outcome: 'RESOLVED', note: '已处理', action: 'NONE' },
        {},
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        errorCode: ErrorCode.REPORT_ALREADY_HANDLED,
      }) as BusinessException,
    );
  });

  it('内容举报结案复用统一隐藏服务', async () => {
    const pending = {
      id: 'report-1',
      status: ReportStatus.PENDING,
      targetType: ReportTargetType.THREAD,
      targetId: 'thread-1',
    };
    prisma.report.findUnique.mockResolvedValue(pending);
    prisma.report.updateMany.mockResolvedValue({ count: 1 });
    prisma.report.findUniqueOrThrow.mockResolvedValue({
      ...pending,
      status: ReportStatus.RESOLVED,
    });
    prisma.thread.findUnique.mockResolvedValue({ deletedAt: new Date(), removalSource: 'ADMIN' });
    const effect = {
      targetType: 'THREAD',
      targetId: 'thread-1',
      hidden: true,
      deletedAt: new Date(),
      threadId: 'thread-1',
    };
    moderation.hideContentInTransaction.mockResolvedValue(effect);

    await service.resolve(
      'report-1',
      { id: 'admin-1', role: UserRole.ADMIN },
      { outcome: 'RESOLVED', note: '违规内容', action: 'HIDE_CONTENT' },
      {},
    );

    expect(moderation.hideContentInTransaction).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ id: 'admin-1' }),
      'THREAD',
      'thread-1',
      '违规内容',
      {},
      'report-1',
    );
    expect(moderation.finalizeContentMutation).toHaveBeenCalledWith(effect);
  });
});
