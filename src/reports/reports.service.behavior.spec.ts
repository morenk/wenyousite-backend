import {
  ReportReasonCode,
  ReportStatus,
  ReportTargetType,
  UserRole,
  UserSanctionType,
} from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AuditService } from '../moderation/audit.service';
import { ModerationService } from '../moderation/moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService behavior', () => {
  const prisma = {
    $transaction: jest.fn(),
    report: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    moderationCase: { findFirst: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
    thread: { findFirst: jest.fn(), findUnique: jest.fn() },
    post: { findFirst: jest.fn(), findUnique: jest.fn() },
    moment: { findFirst: jest.fn(), findUnique: jest.fn() },
    momentComment: { findFirst: jest.fn(), findUnique: jest.fn() },
    directMessage: { findFirst: jest.fn(), findUnique: jest.fn() },
  };
  const moderation = {
    hideContentInTransaction: jest.fn(),
    applySanctionInTransaction: jest.fn(),
    finalizeContentMutation: jest.fn(),
    finalizeUserMutation: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const actor = { id: 'admin-1', username: 'admin', role: UserRole.ADMIN };
  const context = { requestId: 'request-1', ip: '127.0.0.1' };
  const reporterId = 'reporter-1';
  let service: ReportsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    prisma.moderationCase.findFirst.mockResolvedValue({ id: 'case-1' });
    prisma.moderationCase.create.mockResolvedValue({ id: 'case-new' });
    prisma.report.create.mockImplementation(async ({ data }) => ({ id: 'report-1', ...data }));
    prisma.report.updateMany.mockResolvedValue({ count: 1 });
    prisma.report.findUniqueOrThrow.mockResolvedValue({
      id: 'report-1',
      status: ReportStatus.RESOLVED,
      targetType: ReportTargetType.USER,
      targetId: 'user-1',
    });
    audit.record.mockResolvedValue(undefined);
    moderation.applySanctionInTransaction.mockResolvedValue(undefined);
    moderation.finalizeContentMutation.mockResolvedValue(undefined);
    moderation.finalizeUserMutation.mockResolvedValue(undefined);
    service = new ReportsService(
      prisma as unknown as PrismaService,
      moderation as unknown as ModerationService,
      audit as unknown as AuditService,
    );
  });

  function createDto(targetType: ReportTargetType, targetId = 'target-1') {
    return { targetType, targetId, reasonCode: ReportReasonCode.SPAM };
  }

  it('OTHER 原因拒绝空白补充说明', async () => {
    await expect(
      service.create(reporterId, {
        ...createDto(ReportTargetType.USER),
        reasonCode: ReportReasonCode.OTHER,
        details: '   ',
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    [
      ReportTargetType.THREAD,
      () =>
        prisma.thread.findFirst.mockResolvedValue({
          id: 'target-1',
          title: '主题',
          ownerId: 'author-1',
          owner: { id: 'author-1', username: 'author' },
        }),
      'thread',
    ],
    [
      ReportTargetType.MOMENT,
      () =>
        prisma.moment.findFirst.mockResolvedValue({
          id: 'target-1',
          title: '动态',
          content: '内容',
          authorId: 'author-1',
          author: { id: 'author-1', username: 'author' },
        }),
      'moment',
    ],
    [
      ReportTargetType.MOMENT_COMMENT,
      () =>
        prisma.momentComment.findFirst.mockResolvedValue({
          id: 'target-1',
          content: '评论',
          authorId: 'author-1',
          momentId: 'moment-1',
          author: { id: 'author-1', username: 'author' },
        }),
      'comment',
    ],
    [
      ReportTargetType.DIRECT_MESSAGE,
      () =>
        prisma.directMessage.findFirst.mockResolvedValue({
          id: 'target-1',
          conversationId: 'conversation-1',
          senderId: 'sender-1',
          recipientId: reporterId,
          content: '消息',
          recalledAt: null,
          createdAt: new Date(),
          sender: { id: 'sender-1', username: 'sender' },
          media: null,
          sticker: null,
        }),
      'directMessage',
    ],
    [
      ReportTargetType.POST,
      () =>
        prisma.post.findFirst.mockResolvedValue({
          id: 'target-1',
          content: '回帖',
          kind: 'TEXT',
          authorId: 'author-1',
          threadId: 'thread-1',
          author: { id: 'author-1', username: 'author' },
        }),
      'post',
    ],
  ])('为 %s 创建最小必要目标快照', async (targetType, arrange, snapshotKey) => {
    arrange();

    const result = await service.create(reporterId, createDto(targetType));

    expect(result.targetSnapshot).toEqual(
      expect.objectContaining({
        snapshotVersion: 1,
        targetType,
        [snapshotKey]: expect.objectContaining({ id: 'target-1' }),
      }),
    );
  });

  it.each([
    [
      ReportTargetType.USER,
      () => prisma.user.findUnique.mockResolvedValue(null),
      ErrorCode.USER_NOT_FOUND,
    ],
    [
      ReportTargetType.THREAD,
      () => prisma.thread.findFirst.mockResolvedValue(null),
      ErrorCode.THREAD_NOT_FOUND,
    ],
    [
      ReportTargetType.MOMENT,
      () => prisma.moment.findFirst.mockResolvedValue(null),
      ErrorCode.MOMENT_NOT_FOUND,
    ],
    [
      ReportTargetType.MOMENT_COMMENT,
      () => prisma.momentComment.findFirst.mockResolvedValue(null),
      ErrorCode.MOMENT_NOT_FOUND,
    ],
    [
      ReportTargetType.DIRECT_MESSAGE,
      () => prisma.directMessage.findFirst.mockResolvedValue(null),
      ErrorCode.NOT_FOUND,
    ],
    [
      ReportTargetType.POST,
      () => prisma.post.findFirst.mockResolvedValue(null),
      ErrorCode.POST_NOT_FOUND,
    ],
  ])('拒绝不存在或无权查看的 %s 目标', async (targetType, arrange, errorCode) => {
    arrange();
    await expect(service.create(reporterId, createDto(targetType))).rejects.toMatchObject({
      errorCode,
    });
  });

  it.each([
    [
      ReportTargetType.THREAD,
      () => prisma.thread.findFirst.mockResolvedValue({ id: 'target-1', ownerId: reporterId }),
    ],
    [
      ReportTargetType.MOMENT,
      () => prisma.moment.findFirst.mockResolvedValue({ id: 'target-1', authorId: reporterId }),
    ],
    [
      ReportTargetType.MOMENT_COMMENT,
      () =>
        prisma.momentComment.findFirst.mockResolvedValue({ id: 'target-1', authorId: reporterId }),
    ],
    [
      ReportTargetType.POST,
      () => prisma.post.findFirst.mockResolvedValue({ id: 'target-1', authorId: reporterId }),
    ],
  ])('拒绝举报自己的 %s 内容', async (targetType, arrange) => {
    arrange();
    await expect(service.create(reporterId, createDto(targetType))).rejects.toMatchObject({
      errorCode: ErrorCode.BAD_REQUEST,
    });
  });

  it('没有开放案件时创建案件，并规范化举报说明', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', username: 'target' });
    prisma.moderationCase.findFirst.mockResolvedValue(null);

    const result = await service.create(reporterId, {
      ...createDto(ReportTargetType.USER),
      details: '  证据说明  ',
    });

    expect(prisma.moderationCase.create).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ caseId: 'case-new', details: '证据说明' }));
  });

  it('透传非唯一约束的创建错误', async () => {
    const databaseError = new Error('database unavailable');
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', username: 'target' });
    prisma.report.create.mockRejectedValue(databaseError);

    await expect(service.create(reporterId, createDto(ReportTargetType.USER))).rejects.toBe(
      databaseError,
    );
  });

  it('竞争重试再次命中唯一约束时返回稳定冲突码', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', username: 'target' });
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.create(reporterId, createDto(ReportTargetType.USER)),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.REPORT_ALREADY_PENDING,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('竞争重试失败时保留原始非唯一约束错误', async () => {
    const retryError = new Error('retry failed');
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', username: 'target' });
    prisma.report.findFirst.mockResolvedValue(null);
    prisma.report.create.mockRejectedValueOnce({ code: 'P2002' }).mockRejectedValueOnce(retryError);

    await expect(service.create(reporterId, createDto(ReportTargetType.USER))).rejects.toBe(
      retryError,
    );
  });

  it('按筛选条件和游标返回稳定分页', async () => {
    prisma.report.findMany.mockResolvedValue([
      { id: 'report-3' },
      { id: 'report-2' },
      { id: 'report-1' },
    ]);

    const result = await service.findAll({
      status: ReportStatus.PENDING,
      targetType: ReportTargetType.POST,
      reasonCode: ReportReasonCode.SPAM,
      cursor: 'report-4',
      limit: 2,
    });

    expect(result).toEqual({
      items: [{ id: 'report-3' }, { id: 'report-2' }],
      pagination: { cursor: 'report-2', hasMore: true },
    });
    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ReportStatus.PENDING,
          targetType: ReportTargetType.POST,
          reasonCode: ReportReasonCode.SPAM,
        },
        take: 3,
        cursor: { id: 'report-4' },
        skip: 1,
      }),
    );
  });

  it('未传筛选时使用默认分页并返回空游标', async () => {
    prisma.report.findMany.mockResolvedValue([]);
    await expect(service.findAll({})).resolves.toEqual({
      items: [],
      pagination: { cursor: null, hasMore: false },
    });
    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 21, cursor: undefined, skip: 0 }),
    );
  });

  it('读取不存在的举报时返回稳定错误码', async () => {
    prisma.report.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toMatchObject({
      errorCode: ErrorCode.REPORT_NOT_FOUND,
    });
  });

  it.each([
    [
      ReportTargetType.USER,
      () =>
        prisma.user.findUnique.mockResolvedValue({
          id: 'target-1',
          deletedAt: new Date(),
          sanctions: [{ type: UserSanctionType.BAN, endsAt: null }],
        }),
      {
        exists: true,
        deactivated: true,
        currentSanction: { type: UserSanctionType.BAN, endsAt: null },
      },
    ],
    [
      ReportTargetType.DIRECT_MESSAGE,
      () =>
        prisma.directMessage.findUnique.mockResolvedValue({
          id: 'target-1',
          recalledAt: new Date(),
        }),
      { exists: true, recalled: true },
    ],
    [
      ReportTargetType.THREAD,
      () =>
        prisma.thread.findUnique.mockResolvedValue({
          deletedAt: new Date(),
          removalSource: 'ADMIN',
        }),
      { exists: true, hidden: true, removalSource: 'ADMIN' },
    ],
    [
      ReportTargetType.POST,
      () => prisma.post.findUnique.mockResolvedValue({ deletedAt: null, removalSource: null }),
      { exists: true, hidden: false, removalSource: null },
    ],
    [
      ReportTargetType.MOMENT,
      () => prisma.moment.findUnique.mockResolvedValue({ deletedAt: null, removalSource: null }),
      { exists: true, hidden: false, removalSource: null },
    ],
    [
      ReportTargetType.MOMENT_COMMENT,
      () =>
        prisma.momentComment.findUnique.mockResolvedValue({ deletedAt: null, removalSource: null }),
      { exists: true, hidden: false, removalSource: null },
    ],
  ])('读取 %s 举报时返回当前目标状态', async (targetType, arrange, expected) => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'report-1',
      targetType,
      targetId: 'target-1',
    });
    arrange();

    await expect(service.findOne('report-1')).resolves.toEqual(
      expect.objectContaining({ targetState: expected }),
    );
  });

  it.each([
    [ReportTargetType.USER, () => prisma.user.findUnique.mockResolvedValue(null)],
    [
      ReportTargetType.DIRECT_MESSAGE,
      () => prisma.directMessage.findUnique.mockResolvedValue(null),
    ],
    [ReportTargetType.MOMENT, () => prisma.moment.findUnique.mockResolvedValue(null)],
  ])('目标 %s 已不存在时保留举报并标记 exists=false', async (targetType, arrange) => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'report-1',
      targetType,
      targetId: 'target-1',
    });
    arrange();
    await expect(service.findOne('report-1')).resolves.toEqual(
      expect.objectContaining({ targetState: { exists: false } }),
    );
  });

  it('拒绝结案不存在的举报', async () => {
    prisma.report.findUnique.mockResolvedValue(null);
    await expect(
      service.resolve(
        'missing',
        actor,
        { outcome: 'DISMISSED', note: '不存在', action: 'NONE' },
        context,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.REPORT_NOT_FOUND });
  });

  it('乐观认领失败时拒绝覆盖并发结案结果', async () => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'report-1',
      status: ReportStatus.PENDING,
      targetType: ReportTargetType.POST,
      targetId: 'post-1',
    });
    prisma.report.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.resolve(
        'report-1',
        actor,
        { outcome: 'DISMISSED', note: '并发结案', action: 'NONE' },
        context,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.REPORT_ALREADY_HANDLED });
  });

  it.each([
    ['SUSPEND_USER' as const, UserSanctionType.SUSPENSION, '2026-09-01T00:00:00.000Z'],
    ['BAN_USER' as const, UserSanctionType.BAN, undefined],
  ])('用户举报执行 %s 并在提交后刷新用户状态', async (action, sanctionType, suspendUntil) => {
    const pending = {
      id: 'report-1',
      status: ReportStatus.PENDING,
      targetType: ReportTargetType.USER,
      targetId: 'user-1',
    };
    prisma.report.findUnique.mockResolvedValue(pending);
    prisma.report.findUniqueOrThrow.mockResolvedValue({
      ...pending,
      status: ReportStatus.RESOLVED,
    });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', deletedAt: null, sanctions: [] });

    await service.resolve(
      'report-1',
      actor,
      {
        outcome: 'RESOLVED',
        note: '账号违规',
        action,
        ...(suspendUntil ? { suspendUntil } : {}),
      },
      context,
    );

    expect(moderation.applySanctionInTransaction).toHaveBeenCalledWith(
      prisma,
      actor,
      'user-1',
      { type: sanctionType, reason: '账号违规', endsAt: suspendUntil },
      context,
      'report-1',
    );
    expect(moderation.finalizeUserMutation).toHaveBeenCalledWith('user-1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPORT_RESOLVED' }),
      prisma,
    );
  });

  it.each([
    [ReportTargetType.POST, 'DISMISSED', 'HIDE_CONTENT', undefined],
    [ReportTargetType.USER, 'RESOLVED', 'HIDE_CONTENT', undefined],
    [ReportTargetType.POST, 'RESOLVED', 'BAN_USER', undefined],
    [ReportTargetType.USER, 'RESOLVED', 'SUSPEND_USER', undefined],
    [ReportTargetType.USER, 'RESOLVED', 'BAN_USER', '2026-09-01T00:00:00.000Z'],
    [ReportTargetType.USER, 'RESOLVED', 'NONE', '2026-09-01T00:00:00.000Z'],
  ])('拒绝不兼容的结案组合 %#', async (targetType, outcome, action, suspendUntil) => {
    prisma.report.findUnique.mockResolvedValue({
      id: 'report-1',
      status: ReportStatus.PENDING,
      targetType,
      targetId: 'target-1',
    });

    await expect(
      service.resolve(
        'report-1',
        actor,
        { outcome, note: '说明', action, suspendUntil } as never,
        context,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
    expect(prisma.report.updateMany).not.toHaveBeenCalled();
  });
});
