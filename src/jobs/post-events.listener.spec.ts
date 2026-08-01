import { PostEventsListener, PostCreatedEvent } from './post-events.listener';
import { BlockSets } from '../common/services/block-filter.service';

/** 发帖事件监听器测试：验证 THREAD 订阅仅接收楼主/协作者发言的过滤逻辑 */

const redisCatchable = () => Promise.resolve();

function buildListener(overrides: Partial<Record<string, unknown>> = {}) {
  const mentionsService = { parseAndCreate: jest.fn().mockResolvedValue([]) };
  const notificationProducer = { notify: jest.fn().mockResolvedValue(undefined) };
  const subscriptionsService = { findSubscribers: jest.fn().mockResolvedValue([]) };
  const prisma = {
    threadMember: { findMany: jest.fn().mockResolvedValue([]) },
    post: { findUnique: jest.fn() },
  };
  const redis = {
    hincrby: jest.fn(() => redisCatchable()),
    zadd: jest.fn(() => redisCatchable()),
    hgetall: jest.fn().mockResolvedValue({ createdAt: String(Date.now()) }),
  };
  const blockFilter = {
    loadBlockSets: jest.fn().mockResolvedValue({
      blockedByUser: new Set(),
      blockedByAuthor: new Set(),
    } as BlockSets),
    filterRecipients: (ids: string[], sets: BlockSets) =>
      ids.filter(id => !sets.blockedByUser.has(id) && !sets.blockedByAuthor.has(id)),
  };
  const merged = { mentionsService, notificationProducer, subscriptionsService, prisma, redis, blockFilter, ...overrides };
  const listener = new PostEventsListener(
    merged.mentionsService as any,
    merged.notificationProducer as any,
    merged.subscriptionsService as any,
    merged.prisma as any,
    merged.redis as any,
    merged.blockFilter as any,
  );
  return { listener, notificationProducer, subscriptionsService, prisma };
}

const baseEvent: PostCreatedEvent = {
  postId: 'post1',
  content: '测试内容',
  userId: 'author1',
  authorUsername: 'author1',
  threadId: 'thread1',
  subthreadId: 'sub1',
  subthreadTitle: '子贴',
  parentPostId: null,
  replyToPostId: null,
};

describe('PostEventsListener 订阅过滤', () => {
  it('发帖者是楼主时，THREAD 和 USER 订阅者都应收到新帖通知', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
      { userId: 'sub_user', type: 'USER', targetUserId: 'author1' },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'author1' }]);

    await listener.handlePostCreated(baseEvent);

    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      expect.arrayContaining(['sub_thread', 'sub_user']),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('发帖者是协作者时，THREAD 订阅者应收到新帖通知', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([
      { userId: 'owner1' },
      { userId: 'author1' },
    ]);

    await listener.handlePostCreated(baseEvent);

    const args = notificationProducer.notify.mock.calls[0];
    expect(args[0]).toBe('new_post');
    expect(args[1]).toContain('sub_thread');
  });

  it('发帖者是普通玩家时，THREAD 订阅者不应收到通知，USER 订阅者仍收到', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
      { userId: 'sub_user', type: 'USER', targetUserId: 'author1' },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([
      { userId: 'owner1' },
      { userId: 'collab1' },
    ]);

    await listener.handlePostCreated(baseEvent);

    const args = notificationProducer.notify.mock.calls[0];
    expect(args[0]).toBe('new_post');
    expect(args[1]).toContain('sub_user');
    expect(args[1]).not.toContain('sub_thread');
  });

  it('普通玩家发言时，若无人符合接收条件则不产生通知', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([]);

    await listener.handlePostCreated(baseEvent);

    expect(notificationProducer.notify).not.toHaveBeenCalled();
  });
});
