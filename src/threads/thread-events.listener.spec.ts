import { ThreadEventsListener } from './thread-events.listener';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationProducer } from '../notifications/notification.producer';
import type { BlockFilterService } from '../access/block-filter.service';

describe('ThreadEventsListener', () => {
  const prisma = {
    thread: { findUnique: jest.fn() },
    userFollow: { findMany: jest.fn() },
  };
  const notifications = { notify: jest.fn() };
  const blockFilter = {
    loadBlockSets: jest.fn(),
    filterRecipients: jest.fn((ids: string[]) => ids),
  };
  let listener: ThreadEventsListener;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userFollow.findMany.mockResolvedValue([]);
    prisma.thread.findUnique.mockResolvedValue({ visibility: 'PUBLIC' });
    blockFilter.loadBlockSets.mockResolvedValue({
      blockedByUser: new Set(),
      blockedByAuthor: new Set(),
    });
    blockFilter.filterRecipients.mockImplementation((ids: string[]) => ids);
    notifications.notify.mockResolvedValue(undefined);
    listener = new ThreadEventsListener(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationProducer,
      blockFilter as unknown as BlockFilterService,
    );
  });

  it('发布后仅通知通过双向拉黑过滤的粉丝', async () => {
    prisma.userFollow.findMany.mockResolvedValue([{ followerId: 'f1' }, { followerId: 'blocked' }]);
    blockFilter.filterRecipients.mockReturnValue(['f1']);

    await listener.handlePublished({
      threadId: 't1',
      ownerId: 'owner',
      ownerUsername: '楼主',
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      'thread_created',
      ['f1'],
      expect.any(String),
      expect.objectContaining({ eventKey: 'thread-created:t1' }),
    );
  });

  it('私密帖发布不向关注者发送主题创建通知', async () => {
    prisma.userFollow.findMany.mockResolvedValue([{ followerId: 'f1' }]);

    await listener.handlePublished({
      threadId: 'private-thread',
      ownerId: 'owner',
      ownerUsername: '楼主',
      visibility: 'PRIVATE',
    });

    expect(prisma.userFollow.findMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('点赞事件使用本次关系周期的事件键投递幂等通知', async () => {
    await listener.handleLiked({
      eventId: 'cycle-1',
      threadId: 't1',
      ownerId: 'owner',
      threadTitle: '主题',
      userId: 'actor',
      username: '用户',
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      'like',
      ['owner'],
      expect.any(String),
      expect.objectContaining({ eventKey: 'like:cycle-1' }),
    );
  });

  it.each([
    [
      'PARTICIPANT',
      'COLLABORATOR',
      'thread_collaborator_added',
      '你已成为主题「协作主题」的协作者',
    ],
    [
      'COLLABORATOR',
      'PARTICIPANT',
      'thread_collaborator_removed',
      '你已不再是主题「协作主题」的协作者',
    ],
  ] as const)(
    '任免协作者发送带稳定事件键的 system 通知：%s → %s',
    async (oldRole, newRole, action, content) => {
      await listener.handleCollaboratorRoleChanged({
        eventId: 'event-1',
        threadId: 'thread-1',
        threadTitle: '协作主题',
        actorId: 'owner',
        actorName: '楼主',
        targetUserId: 'target',
        oldRole,
        newRole,
      });

      expect(notifications.notify).toHaveBeenCalledWith('system', ['target'], content, {
        threadId: 'thread-1',
        fromUserId: 'owner',
        eventKey: 'thread-collaborator-role:event-1',
        payload: {
          action,
          threadId: 'thread-1',
          threadTitle: '协作主题',
          actorId: 'owner',
          actorName: '楼主',
          oldRole,
          newRole,
        },
      });
    },
  );
});
