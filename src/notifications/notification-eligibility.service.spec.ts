import { ContentRemovalSource } from '@prisma/client';
import { ThreadAccessService } from '../access/thread-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEligibilityService } from './notification-eligibility.service';

describe('NotificationEligibilityService', () => {
  const prisma = {
    post: { findUnique: jest.fn() },
    moment: { findUnique: jest.fn() },
    momentComment: { findUnique: jest.fn() },
  };
  const access = { filterAccessibleUserIds: jest.fn() };
  const service = new NotificationEligibilityService(
    prisma as unknown as PrismaService,
    access as unknown as ThreadAccessService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    access.filterAccessibleUserIds.mockImplementation(
      async (_threadId: string, userIds: string[]) => userIds,
    );
  });

  it('主题通知在最终落库前按私密帖当前成员资格过滤', async () => {
    access.filterAccessibleUserIds.mockResolvedValue(['member']);

    await expect(
      service.filterRecipients({
        type: 'mention',
        recipients: ['member', 'follower'],
        content: '提及',
        threadId: 'private-thread',
      }),
    ).resolves.toEqual(['member']);
  });

  it('父楼层已删除时拒绝向存活子回复写入通知', async () => {
    prisma.post.findUnique.mockResolvedValue({
      threadId: 'thread-1',
      deletedAt: null,
      parentPost: { deletedAt: new Date() },
      subthread: { deletedAt: null },
      thread: { deletedAt: null },
    });

    await expect(
      service.filterRecipients({
        type: 'reply',
        recipients: ['user-1'],
        content: '回复',
        postId: 'reply-1',
        threadId: 'thread-1',
      }),
    ).resolves.toEqual([]);
    expect(access.filterAccessibleUserIds).not.toHaveBeenCalled();
  });

  it('管理员隐藏根评论后拒绝向其子回复投递通知', async () => {
    prisma.momentComment.findUnique.mockResolvedValue({
      momentId: 'moment-1',
      deletedAt: null,
      moment: { deletedAt: null },
      parentComment: {
        deletedAt: new Date(),
        removalSource: ContentRemovalSource.ADMIN,
      },
    });

    await expect(
      service.filterRecipients({
        type: 'reply',
        recipients: ['user-1'],
        content: '回复',
        momentId: 'moment-1',
        momentCommentId: 'reply-1',
      }),
    ).resolves.toEqual([]);
  });

  it('作者删除根评论仍保留墓碑语义，子回复通知可继续投递', async () => {
    prisma.momentComment.findUnique.mockResolvedValue({
      momentId: 'moment-1',
      deletedAt: null,
      moment: { deletedAt: null },
      parentComment: {
        deletedAt: new Date(),
        removalSource: ContentRemovalSource.AUTHOR,
      },
    });

    await expect(
      service.filterRecipients({
        type: 'reply',
        recipients: ['user-1'],
        content: '回复',
        momentId: 'moment-1',
        momentCommentId: 'reply-1',
      }),
    ).resolves.toEqual(['user-1']);
  });
});
