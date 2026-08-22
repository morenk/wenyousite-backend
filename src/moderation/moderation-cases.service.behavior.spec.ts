import {
  ContentRemovalSource,
  ModerationAppealStatus,
  ModerationCaseStatus,
  ModerationDecisionAction,
  ReportReasonCode,
  ReportStatus,
  ReportTargetType,
  UserRole,
  UserSanctionType,
} from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { ModerationCasesService } from './moderation-cases.service';
import { ModerationService } from './moderation.service';

describe('ModerationCasesService behavior', () => {
  const prisma = {
    $transaction: jest.fn(),
    moderationCase: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    moderationDecision: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    moderationAppeal: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    report: { updateMany: jest.fn() },
    userSanction: { update: jest.fn() },
    thread: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    post: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    moment: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    momentComment: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    directMessage: { findMany: jest.fn(), findUnique: jest.fn() },
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
  let service: ModerationCasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      return (input as (tx: typeof prisma) => Promise<unknown>)(prisma);
    });
    prisma.report.updateMany.mockResolvedValue({ count: 1 });
    prisma.moderationCase.update.mockResolvedValue({});
    prisma.moderationDecision.create.mockResolvedValue({ id: 'decision-1' });
    prisma.moderationDecision.update.mockResolvedValue({});
    prisma.moderationAppeal.update.mockResolvedValue({});
    prisma.moderationAppeal.findUniqueOrThrow.mockResolvedValue({ id: 'appeal-1' });
    prisma.userSanction.update.mockResolvedValue({});
    audit.record.mockResolvedValue(undefined);
    moderation.hideContentInTransaction.mockResolvedValue({
      targetType: 'THREAD',
      targetId: 'target-1',
      hidden: true,
      deletedAt: new Date(),
      threadId: 'target-1',
    });
    moderation.applySanctionInTransaction.mockResolvedValue(undefined);
    moderation.finalizeContentMutation.mockResolvedValue(undefined);
    moderation.finalizeUserMutation.mockResolvedValue(undefined);
    service = new ModerationCasesService(
      prisma as unknown as PrismaService,
      moderation as unknown as ModerationService,
      audit as unknown as AuditService,
    );
  });

  function openCase(targetType: ReportTargetType = ReportTargetType.THREAD, targetId = 'target-1') {
    return {
      id: 'case-1',
      status: ModerationCaseStatus.OPEN,
      targetType,
      targetId,
      reports: [{ id: 'report-1' }],
    };
  }

  it('案件列表应用筛选、游标并返回稳定分页', async () => {
    prisma.moderationCase.findMany.mockResolvedValue([{ id: 'case-2' }, { id: 'case-1' }]);
    const result = await service.listCases({
      limit: 1,
      cursor: 'cursor-1',
      status: ModerationCaseStatus.OPEN,
      targetType: ReportTargetType.POST,
      reasonCode: ReportReasonCode.SPAM,
    });

    expect(result).toEqual({
      items: [{ id: 'case-2' }],
      pagination: { cursor: 'case-2', hasMore: true },
    });
    expect(prisma.moderationCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ModerationCaseStatus.OPEN,
          targetType: ReportTargetType.POST,
          reports: { some: { reasonCode: ReportReasonCode.SPAM } },
        },
        take: 2,
        cursor: { id: 'cursor-1' },
        skip: 1,
      }),
    );
  });

  it('读取案件详情并将不存在映射为稳定错误码', async () => {
    prisma.moderationCase.findUnique
      .mockResolvedValueOnce({ id: 'case-1' })
      .mockResolvedValueOnce(null);
    await expect(service.getCase('case-1')).resolves.toEqual({ id: 'case-1' });
    await expect(service.getCase('missing')).rejects.toMatchObject({
      errorCode: ErrorCode.MODERATION_CASE_NOT_FOUND,
    });
  });

  it('驳回案件时原子关闭全部待处理举报并记录审计', async () => {
    prisma.moderationCase.findUnique
      .mockResolvedValueOnce(openCase())
      .mockResolvedValueOnce({ id: 'case-1', status: ModerationCaseStatus.DISMISSED });

    const result = await service.resolveCase(
      'case-1',
      actor,
      {
        outcome: 'DISMISSED',
        policyCode: ReportReasonCode.OTHER,
        publicExplanation: '  证据不足  ',
      },
      context,
    );

    expect(result).toEqual(expect.objectContaining({ decisionId: null }));
    expect(prisma.report.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ReportStatus.DISMISSED,
          resolutionNote: '证据不足',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_DISMISSED', reason: '证据不足' }),
      prisma,
    );
  });

  it('确认内容违规时创建决定、复用隐藏服务并在提交后刷新派生状态', async () => {
    prisma.moderationCase.findUnique
      .mockResolvedValueOnce(openCase(ReportTargetType.THREAD))
      .mockResolvedValueOnce({ id: 'case-1', status: ModerationCaseStatus.RESOLVED });
    const effect = {
      targetType: 'THREAD' as const,
      targetId: 'target-1',
      hidden: true,
      deletedAt: new Date(),
      threadId: 'target-1',
    };
    moderation.hideContentInTransaction.mockResolvedValue(effect);

    const result = await service.resolveCase(
      'case-1',
      actor,
      {
        outcome: 'RESOLVED',
        action: ModerationDecisionAction.HIDE_CONTENT,
        policyCode: ReportReasonCode.SPAM,
        publicExplanation: '  违规内容  ',
        internalNote: '  内部证据  ',
      },
      context,
    );

    expect(result.decisionId).toBe('decision-1');
    expect(prisma.moderationDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publicExplanation: '违规内容', internalNote: '内部证据' }),
      }),
    );
    expect(moderation.hideContentInTransaction).toHaveBeenCalledWith(
      prisma,
      actor,
      ReportTargetType.THREAD,
      'target-1',
      '  违规内容  ',
      context,
      'report-1',
    );
    expect(moderation.finalizeContentMutation).toHaveBeenCalledWith(effect);
  });

  it.each([
    [ModerationDecisionAction.BAN_USER, UserSanctionType.BAN, undefined],
    [
      ModerationDecisionAction.SUSPEND_USER,
      UserSanctionType.SUSPENSION,
      '2026-09-01T00:00:00.000Z',
    ],
  ])('账号处置 %s 在事务内调用统一处罚服务', async (action, type, suspendUntil) => {
    prisma.moderationCase.findUnique
      .mockResolvedValueOnce(openCase(ReportTargetType.USER, 'user-1'))
      .mockResolvedValueOnce({ id: 'case-1' });

    await service.resolveCase(
      'case-1',
      actor,
      {
        outcome: 'RESOLVED',
        action,
        policyCode: ReportReasonCode.HARASSMENT,
        publicExplanation: '违规账号',
        ...(suspendUntil ? { suspendUntil } : {}),
      },
      context,
    );

    expect(moderation.applySanctionInTransaction).toHaveBeenCalledWith(
      prisma,
      actor,
      'user-1',
      { type, reason: '违规账号', endsAt: suspendUntil },
      context,
      'report-1',
      'decision-1',
    );
    expect(moderation.finalizeUserMutation).toHaveBeenCalledWith('user-1');
  });

  it('拒绝不存在或已经关闭的案件', async () => {
    prisma.moderationCase.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.resolveCase(
        'missing',
        actor,
        {
          outcome: 'DISMISSED',
          policyCode: ReportReasonCode.OTHER,
          publicExplanation: '无效',
        },
        context,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.MODERATION_CASE_NOT_FOUND });

    prisma.moderationCase.findUnique.mockResolvedValueOnce({
      ...openCase(),
      status: ModerationCaseStatus.RESOLVED,
    });
    await expect(
      service.resolveCase(
        'closed',
        actor,
        {
          outcome: 'DISMISSED',
          policyCode: ReportReasonCode.OTHER,
          publicExplanation: '无效',
        },
        context,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.MODERATION_CASE_ALREADY_CLOSED });
  });

  it.each([
    [
      ReportTargetType.THREAD,
      { outcome: 'DISMISSED', action: ModerationDecisionAction.HIDE_CONTENT },
    ],
    [ReportTargetType.THREAD, { outcome: 'RESOLVED' }],
    [ReportTargetType.USER, { outcome: 'RESOLVED', action: ModerationDecisionAction.HIDE_CONTENT }],
    [ReportTargetType.USER, { outcome: 'RESOLVED', action: ModerationDecisionAction.SUSPEND_USER }],
    [
      ReportTargetType.USER,
      {
        outcome: 'RESOLVED',
        action: ModerationDecisionAction.BAN_USER,
        suspendUntil: '2026-09-01T00:00:00Z',
      },
    ],
  ])('拒绝不一致的结案动作 %#', async (targetType, partial) => {
    prisma.moderationCase.findUnique.mockResolvedValue(openCase(targetType));
    await expect(
      service.resolveCase(
        'case-1',
        actor,
        {
          policyCode: ReportReasonCode.OTHER,
          publicExplanation: '说明',
          ...partial,
        } as never,
        context,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
  });

  it('汇总用户所有目标类型的近 30 天决定', async () => {
    prisma.thread.findMany.mockResolvedValue([{ id: 'thread-1' }]);
    prisma.post.findMany.mockResolvedValue([{ id: 'post-1' }]);
    prisma.moment.findMany.mockResolvedValue([{ id: 'moment-1' }]);
    prisma.momentComment.findMany.mockResolvedValue([{ id: 'comment-1' }]);
    prisma.directMessage.findMany.mockResolvedValue([{ id: 'message-1' }]);
    prisma.moderationDecision.findMany.mockResolvedValue([{ id: 'decision-1' }]);

    await expect(service.listMyDecisions('user-1')).resolves.toEqual([{ id: 'decision-1' }]);
    const where = prisma.moderationDecision.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { targetType: ReportTargetType.USER, targetId: 'user-1' },
        { targetType: ReportTargetType.THREAD, targetId: { in: ['thread-1'] } },
        { targetType: ReportTargetType.DIRECT_MESSAGE, targetId: { in: ['message-1'] } },
      ]),
    );
  });

  it.each([
    [null, ErrorCode.MODERATION_DECISION_NOT_FOUND],
    [{ active: false, createdAt: new Date(), appeal: null }, ErrorCode.APPEAL_WINDOW_CLOSED],
    [
      { active: true, createdAt: new Date(Date.now() - 31 * 86_400_000), appeal: null },
      ErrorCode.APPEAL_WINDOW_CLOSED,
    ],
    [
      { active: true, createdAt: new Date(), appeal: { id: 'appeal-1' } },
      ErrorCode.APPEAL_ALREADY_SUBMITTED,
    ],
  ])('拒绝不可申诉的治理决定 %#', async (decision, errorCode) => {
    prisma.moderationDecision.findUnique.mockResolvedValue(decision);
    await expect(service.createAppeal('user-1', 'decision-1', '申诉内容')).rejects.toMatchObject({
      errorCode,
    });
  });

  it('仅目标所有者可申诉且并发唯一键冲突保持稳定错误码', async () => {
    const decision = {
      id: 'decision-1',
      active: true,
      createdAt: new Date(),
      appeal: null,
      targetType: ReportTargetType.THREAD,
      targetId: 'thread-1',
    };
    prisma.moderationDecision.findUnique.mockResolvedValue(decision);
    prisma.thread.findUnique.mockResolvedValueOnce({ ownerId: 'other-user' });
    await expect(service.createAppeal('user-1', 'decision-1', '申诉内容')).rejects.toMatchObject({
      errorCode: ErrorCode.MODERATION_DECISION_NOT_FOUND,
    });

    prisma.thread.findUnique.mockResolvedValueOnce({ ownerId: 'user-1' });
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.createAppeal('user-1', 'decision-1', '申诉内容')).rejects.toMatchObject({
      errorCode: ErrorCode.APPEAL_ALREADY_SUBMITTED,
    });
  });

  it('申诉列表应用决定筛选和游标分页', async () => {
    prisma.moderationAppeal.findMany.mockResolvedValue([{ id: 'appeal-2' }, { id: 'appeal-1' }]);
    const result = await service.listAppeals({
      limit: 1,
      cursor: 'cursor-1',
      status: ModerationAppealStatus.PENDING,
      targetType: ReportTargetType.POST,
      action: ModerationDecisionAction.HIDE_CONTENT,
    });
    expect(result.pagination).toEqual({ cursor: 'appeal-2', hasMore: true });
    expect(prisma.moderationAppeal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: ModerationAppealStatus.PENDING,
          decision: {
            targetType: ReportTargetType.POST,
            action: ModerationDecisionAction.HIDE_CONTENT,
          },
        },
        cursor: { id: 'cursor-1' },
        skip: 1,
      }),
    );
  });

  it('维持申诉时不撤销原决定，只更新状态并写审计', async () => {
    prisma.moderationAppeal.findUnique.mockResolvedValue({
      id: 'appeal-1',
      status: ModerationAppealStatus.PENDING,
      decisionId: 'decision-1',
      decision: { active: true, action: ModerationDecisionAction.BAN_USER, sanction: null },
    });

    await service.resolveAppeal(
      'appeal-1',
      actor,
      { outcome: 'UPHELD', note: '  维持  ' },
      context,
    );

    expect(prisma.moderationDecision.update).not.toHaveBeenCalled();
    expect(prisma.moderationAppeal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ModerationAppealStatus.UPHELD,
          handledNote: '维持',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPEAL_UPHELD', reason: '维持' }),
      prisma,
    );
  });

  it.each([
    [
      ReportTargetType.THREAD,
      'thread',
      { deletedAt: new Date(), removalSource: ContentRemovalSource.ADMIN },
      { targetType: 'THREAD', threadId: 'target-1' },
    ],
    [
      ReportTargetType.POST,
      'post',
      {
        deletedAt: new Date(),
        removalSource: ContentRemovalSource.ADMIN,
        threadId: 'thread-1',
        parentPostId: 'parent-1',
      },
      { targetType: 'POST', threadId: 'thread-1' },
    ],
    [
      ReportTargetType.MOMENT,
      'moment',
      { deletedAt: new Date(), removalSource: ContentRemovalSource.ADMIN },
      { targetType: 'MOMENT', momentId: 'target-1' },
    ],
    [
      ReportTargetType.MOMENT_COMMENT,
      'momentComment',
      { deletedAt: new Date(), removalSource: ContentRemovalSource.ADMIN, momentId: 'moment-1' },
      { targetType: 'MOMENT_COMMENT', momentId: 'moment-1' },
    ],
  ])('推翻内容决定时恢复 %s 并在提交后刷新', async (targetType, model, row, effectShape) => {
    prisma.moderationAppeal.findUnique.mockResolvedValue({
      id: 'appeal-1',
      status: ModerationAppealStatus.PENDING,
      decisionId: 'decision-1',
      decision: {
        active: true,
        action: ModerationDecisionAction.HIDE_CONTENT,
        targetType,
        targetId: 'target-1',
        sanction: null,
      },
    });
    const modelClient = prisma[model as 'thread' | 'post' | 'moment' | 'momentComment'];
    modelClient.findUnique.mockResolvedValue(row);
    modelClient.update.mockResolvedValue({});

    await service.resolveAppeal(
      'appeal-1',
      actor,
      { outcome: 'OVERTURNED', note: '恢复' },
      context,
    );

    expect(modelClient.update).toHaveBeenCalled();
    expect(prisma.moderationDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ active: false, reversedById: 'admin-1' }),
      }),
    );
    expect(moderation.finalizeContentMutation).toHaveBeenCalledWith(
      expect.objectContaining(effectShape),
    );
    if (targetType === ReportTargetType.MOMENT_COMMENT) {
      expect(prisma.moment.update).toHaveBeenCalledWith({
        where: { id: 'moment-1' },
        data: { commentCount: { increment: 1 } },
      });
    }
  });

  it('推翻账号处罚时撤销处罚并在提交后刷新账号状态', async () => {
    prisma.moderationAppeal.findUnique.mockResolvedValue({
      id: 'appeal-1',
      status: ModerationAppealStatus.PENDING,
      decisionId: 'decision-1',
      decision: {
        active: true,
        action: ModerationDecisionAction.BAN_USER,
        sanction: { id: 'sanction-1', userId: 'user-1', revokedAt: null },
      },
    });

    await service.resolveAppeal(
      'appeal-1',
      actor,
      { outcome: 'OVERTURNED', note: '  撤销处罚  ' },
      context,
    );

    expect(prisma.userSanction.update).toHaveBeenCalledWith({
      where: { id: 'sanction-1' },
      data: { revokedAt: expect.any(Date), revokedById: 'admin-1', revokeReason: '撤销处罚' },
    });
    expect(moderation.finalizeUserMutation).toHaveBeenCalledWith('user-1');
  });

  it('拒绝不存在、已处理或已撤销决定的申诉', async () => {
    prisma.moderationAppeal.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.resolveAppeal('missing', actor, { outcome: 'UPHELD', note: '无效' }, context),
    ).rejects.toMatchObject({ errorCode: ErrorCode.MODERATION_APPEAL_NOT_FOUND });
    prisma.moderationAppeal.findUnique.mockResolvedValueOnce({
      status: ModerationAppealStatus.UPHELD,
    });
    await expect(
      service.resolveAppeal('handled', actor, { outcome: 'UPHELD', note: '无效' }, context),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT });
    prisma.moderationAppeal.findUnique.mockResolvedValueOnce({
      status: ModerationAppealStatus.PENDING,
      decision: { active: false },
    });
    await expect(
      service.resolveAppeal('reversed', actor, { outcome: 'OVERTURNED', note: '无效' }, context),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT });
  });

  it('内容不再处于管理员隐藏状态时拒绝恢复', async () => {
    prisma.moderationAppeal.findUnique.mockResolvedValue({
      id: 'appeal-1',
      status: ModerationAppealStatus.PENDING,
      decisionId: 'decision-1',
      decision: {
        active: true,
        action: ModerationDecisionAction.HIDE_CONTENT,
        targetType: ReportTargetType.THREAD,
        targetId: 'thread-1',
        sanction: null,
      },
    });
    prisma.thread.findUnique.mockResolvedValue({ deletedAt: null, removalSource: null });

    await expect(
      service.resolveAppeal('appeal-1', actor, { outcome: 'OVERTURNED', note: '恢复' }, context),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CONTENT_STATE_CONFLICT });
  });
});
