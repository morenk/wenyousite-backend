import { ThreadEventsListener } from './thread-events.listener';

describe('ThreadEventsListener', () => {
  const prisma = { userFollow: { findMany: jest.fn() } };
  const notifications = { notify: jest.fn() };
  const blockFilter = {
    loadBlockSets: jest.fn(),
    filterRecipients: jest.fn((ids: string[]) => ids),
  };
  let listener: ThreadEventsListener;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userFollow.findMany.mockResolvedValue([]);
    blockFilter.loadBlockSets.mockResolvedValue({
      blockedByUser: new Set(),
      blockedByAuthor: new Set(),
    });
    blockFilter.filterRecipients.mockImplementation((ids: string[]) => ids);
    notifications.notify.mockResolvedValue(undefined);
    listener = new ThreadEventsListener(prisma as any, notifications as any, blockFilter as any);
  });

  it('发布后仅通知通过双向拉黑过滤的粉丝', async () => {
    prisma.userFollow.findMany.mockResolvedValue([
      { followerId: 'f1' },
      { followerId: 'blocked' },
    ]);
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
});
