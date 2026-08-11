import {
  AuditAction,
  AuditTargetType,
  ModerationAppealStatus,
  ModerationDecisionAction,
  ReportReasonCode,
  ReportTargetType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { ModerationCasesService } from './moderation-cases.service';
import { ModerationService } from './moderation.service';

describe('ModerationCasesService createAppeal', () => {
  const prisma = {
    moderationDecision: { findUnique: jest.fn() },
    moderationAppeal: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const moderation = {};
  const audit = { record: jest.fn() };
  const service = new ModerationCasesService(
    prisma as unknown as PrismaService,
    moderation as ModerationService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
  });

  it('201 返回必定包含公开 decision 与 appellant 关系', async () => {
    const createdAt = new Date();
    prisma.moderationDecision.findUnique.mockResolvedValue({
      id: 'decision-1',
      targetType: ReportTargetType.USER,
      targetId: 'user-1',
      active: true,
      createdAt,
      appeal: null,
    });
    const response = {
      id: 'appeal-1',
      statement: '请重新审核',
      status: ModerationAppealStatus.PENDING,
      createdAt,
      decision: {
        id: 'decision-1',
        targetType: ReportTargetType.USER,
        targetId: 'user-1',
        action: ModerationDecisionAction.SUSPEND_USER,
        policyCode: ReportReasonCode.SPAM,
        publicExplanation: '违规说明',
        active: true,
        createdAt,
      },
      appellant: { id: 'user-1', username: 'tester' },
    };
    prisma.moderationAppeal.create.mockResolvedValue(response);

    await expect(
      service.createAppeal('user-1', 'decision-1', '  请重新审核  '),
    ).resolves.toEqual(response);
    expect(prisma.moderationAppeal.create).toHaveBeenCalledWith({
      data: {
        decisionId: 'decision-1',
        appellantId: 'user-1',
        statement: '请重新审核',
      },
      select: {
        id: true,
        statement: true,
        status: true,
        createdAt: true,
        decision: {
          select: {
            id: true,
            targetType: true,
            targetId: true,
            action: true,
            policyCode: true,
            publicExplanation: true,
            active: true,
            createdAt: true,
          },
        },
        appellant: { select: { id: true, username: true } },
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorId: 'user-1',
        action: AuditAction.APPEAL_SUBMITTED,
        targetType: AuditTargetType.MODERATION_APPEAL,
        targetId: 'appeal-1',
        metadata: { decisionId: 'decision-1' },
      },
      prisma,
    );
  });
});
