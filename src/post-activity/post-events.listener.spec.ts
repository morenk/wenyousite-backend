import { PostEventsListener, PostCreatedEvent } from './post-events.listener';
import { BlockSets } from '../access/block-filter.service';

/** 发帖事件监听器测试：验证 THREAD 订阅仅接收楼主/协作者发言的过滤逻辑 */

const redisCatchable = () => Promise.resolve();

function buildListener(overrides: Partial<Record<string, unknown>> = {}) {
  const mentionsService = { parseAndCreate: jest.fn().mockResolvedValue([]) };
  const notificationProducer = { notify: jest.fn().mockResolvedValue(undefined) };
  const subscriptionsService = { findSubscribers: jest.fn().mockResolvedValue([]) };
  const prisma = {
    threadMember: { findMany: jest.fn().mockResolvedValue([]) },
    thread: { findUnique: jest.fn() },
    post: { findUnique: jest.fn(), count: jest.fn().mockResolvedValue(1) },
  };
  const redis = {
    hincrby: jest.fn(() => redisCatchable()),
    hset: jest.fn(() => redisCatchable()),
    zadd: jest.fn(() => redisCatchable()),
    hgetall: jest.fn().mockResolvedValue({ createdAt: String(Date.now()) }),
  };
  const blockFilter = {
    loadBlockSets: jest.fn().mockResolvedValue({
      blockedByUser: new Set(),
      blockedByAuthor: new Set(),
    } as BlockSets),
    filterRecipients: (ids: string[], sets: BlockSets) =>
      ids.filter((id) => !sets.blockedByUser.has(id) && !sets.blockedByAuthor.has(id)),
  };
  const merged = {
    mentionsService,
    notificationProducer,
    subscriptionsService,
    prisma,
    redis,
    blockFilter,
    ...overrides,
  };
  const listener = new PostEventsListener(
    merged.mentionsService as any,
    merged.notificationProducer as any,
    merged.subscriptionsService as any,
    merged.prisma as any,
    merged.redis as any,
    merged.blockFilter as any,
  );
  return {
    listener,
    notificationProducer,
    subscriptionsService,
    prisma,
    mentionsService,
    redis,
  };
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
  authorRole: 'PARTICIPANT',
  authorPlayerMarked: true,
};

describe('PostEventsListener 订阅过滤', () => {
  it('发帖者是楼主时只触发 THREAD 官方更新订阅', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
      { userId: 'sub_user', type: 'USER', targetUserId: 'author1' },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'author1' }]);

    await listener.handlePostCreated({
      ...baseEvent,
      authorRole: 'OWNER',
      authorPlayerMarked: true,
    });

    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['sub_thread'],
      expect.any(String),
      expect.any(Object),
    );
  });

  it('发帖者是协作者时，THREAD 订阅者应收到新帖通知', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }, { userId: 'author1' }]);

    await listener.handlePostCreated({
      ...baseEvent,
      authorRole: 'COLLABORATOR',
      authorPlayerMarked: false,
    });

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
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }, { userId: 'collab1' }]);

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

  it('未标记玩家的普通参与人不会触发 USER 订阅', async () => {
    const { listener, notificationProducer, subscriptionsService } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_user', type: 'USER', targetUserId: 'author1' },
    ]);

    await listener.handlePostCreated({ ...baseEvent, authorPlayerMarked: false });

    expect(notificationProducer.notify).not.toHaveBeenCalled();
  });

  it('同一条回复显式艾特后，不再发送重复的 reply 次级通知', async () => {
    const { listener, notificationProducer, prisma, mentionsService } = buildListener();
    mentionsService.parseAndCreate.mockResolvedValue([{ userId: 'replyAuthor' }]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }]);
    prisma.post.findUnique.mockResolvedValue({ authorId: 'replyAuthor' });

    await listener.handlePostCreated({
      ...baseEvent,
      postId: 'reply-post',
      parentPostId: 'parent-post',
      replyToPostId: 'parent-post',
    });

    const mentionCall = notificationProducer.notify.mock.calls.find(
      (call: unknown[]) => call[0] === 'mention',
    );
    const replyCall = notificationProducer.notify.mock.calls.find(
      (call: unknown[]) => call[0] === 'reply',
    );
    expect(mentionCall?.[1]).toEqual(['replyAuthor']);
    expect(replyCall?.[1]).not.toContain('replyAuthor');
    expect(replyCall?.[1]).toEqual(expect.arrayContaining(['owner1']));
  });

  it('通知处理失败时向 Outbox 抛出错误以触发重试', async () => {
    const { listener, notificationProducer, subscriptionsService } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'subscriber', type: 'USER', targetUserId: 'author1' },
    ]);
    notificationProducer.notify.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(listener.handlePostCreated(baseEvent)).rejects.toThrow(
      'post.created event processing failed',
    );
  });

  it('点赞投影读取数据库权威计数并覆盖 Redis，重复投递不会重复累加', async () => {
    const { listener, prisma, redis } = buildListener();
    prisma.thread.findUnique.mockResolvedValue({ likeCount: 7 });

    await listener.handleThreadLiked({ threadId: 'thread1' });
    await listener.handleThreadLiked({ threadId: 'thread1' });

    expect(redis.hset).toHaveBeenNthCalledWith(1, 'thread:thread1:stats', 'likes', '7');
    expect(redis.hset).toHaveBeenNthCalledWith(2, 'thread:thread1:stats', 'likes', '7');
    expect(redis.hincrby).not.toHaveBeenCalledWith('thread:thread1:stats', 'likes', 1);
  });

  it('发帖投影重复投递时覆盖数据库权威计数而非累加', async () => {
    const { listener, prisma, redis } = buildListener();
    prisma.post.count.mockResolvedValue(3);

    await listener.handlePostCreated(baseEvent);
    await listener.handlePostCreated(baseEvent);

    const replyWrites = redis.hset.mock.calls.filter(
      (call: unknown[]) => call[0] === 'thread:thread1:stats' && call[1] === 'replies',
    );
    expect(replyWrites).toEqual([
      ['thread:thread1:stats', 'replies', '3'],
      ['thread:thread1:stats', 'replies', '3'],
    ]);
  });
});
