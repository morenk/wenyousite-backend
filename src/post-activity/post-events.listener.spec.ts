import { PostEventsListener, PostCreatedEvent } from './post-events.listener';
import type { MentionsService } from '../mentions/mentions.service';
import type { NotificationProducer } from '../notifications/notification.producer';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { BlockFilterService, BlockSets } from '../access/block-filter.service';

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
    merged.mentionsService as unknown as MentionsService,
    merged.notificationProducer as unknown as NotificationProducer,
    merged.subscriptionsService as unknown as SubscriptionsService,
    merged.prisma as unknown as PrismaService,
    merged.redis as unknown as RedisService,
    merged.blockFilter as unknown as BlockFilterService,
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

  it('楼中楼回复优先使用 replyToPostId 的作者生成目标语义且不改变接收范围', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'subscriber1', type: 'USER', targetUserId: 'author1' },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }]);
    prisma.post.findUnique.mockResolvedValue({
      authorId: 'target1',
      author: { username: '阿忠' },
    });

    await listener.handlePostCreated({
      ...baseEvent,
      authorUsername: '科尔诺鹿雅',
      postId: 'reply-post',
      parentPostId: 'parent-post',
      replyToPostId: 'target-post',
    });

    expect(prisma.post.findUnique).toHaveBeenCalledWith({
      where: { id: 'target-post', deletedAt: null },
      select: {
        authorId: true,
        author: { select: { username: true } },
      },
    });
    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'reply',
      ['target1', 'owner1', 'subscriber1'],
      '科尔诺鹿雅 回复了阿忠：测试内容',
      {
        postId: 'reply-post',
        threadId: 'thread1',
        fromUserId: 'author1',
        eventKey: 'reply:reply-post',
        payload: {
          actorName: '科尔诺鹿雅',
          action: 'reply',
          preview: '测试内容',
          replyTargetUserId: 'target1',
          replyTargetName: '阿忠',
        },
      },
    );
  });

  it('未指定 replyToPostId 时使用父楼层作者作为回复目标', async () => {
    const { listener, notificationProducer, prisma } = buildListener();
    prisma.post.findUnique.mockResolvedValue({
      authorId: 'floorAuthor',
      author: { username: '楼层作者' },
    });

    await listener.handlePostCreated({
      ...baseEvent,
      postId: 'reply-post',
      parentPostId: 'parent-post',
      replyToPostId: null,
    });

    expect(prisma.post.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'parent-post', deletedAt: null } }),
    );
    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'reply',
      ['floorAuthor'],
      'author1 回复了楼层作者：测试内容',
      expect.objectContaining({
        payload: expect.objectContaining({
          replyTargetUserId: 'floorAuthor',
          replyTargetName: '楼层作者',
        }),
      }),
    );
  });

  it('回复自己的帖子时继续不向管理者或订阅者发送 reply 通知', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'subscriber1', type: 'USER', targetUserId: 'author1' },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }]);
    prisma.post.findUnique.mockResolvedValue({
      authorId: 'author1',
      author: { username: 'author1' },
    });

    await listener.handlePostCreated({
      ...baseEvent,
      parentPostId: 'parent-post',
    });

    expect(notificationProducer.notify).not.toHaveBeenCalled();
  });

  it('同一条回复显式艾特后，不再发送重复的 reply 次级通知', async () => {
    const { listener, notificationProducer, prisma, mentionsService } = buildListener();
    mentionsService.parseAndCreate.mockResolvedValue([{ userId: 'replyAuthor' }]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }]);
    prisma.post.findUnique.mockResolvedValue({
      authorId: 'replyAuthor',
      author: { username: '被回复者' },
    });

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
    expect(replyCall?.[3]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          replyTargetUserId: 'replyAuthor',
          replyTargetName: '被回复者',
        }),
      }),
    );
  });

  it('通知处理失败时向 Outbox 抛出错误以触发重试', async () => {
    const { listener, notificationProducer, subscriptionsService } = buildListener();
    const loggerError = jest
      .spyOn(
        (listener as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'subscriber', type: 'USER', targetUserId: 'author1' },
    ]);
    notificationProducer.notify.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(listener.handlePostCreated(baseEvent)).rejects.toThrow(
      'post.created event processing failed',
    );
    expect(loggerError).toHaveBeenCalled();
    loggerError.mockRestore();
  });

  it('编辑提及事件去重接收者并沿用稳定通知键', async () => {
    const { listener, notificationProducer } = buildListener();
    const event = {
      postId: 'post-edited',
      threadId: 'thread1',
      userId: 'author1',
      authorUsername: '作者',
      recipientIds: ['user2', 'user2', 'author1'],
      preview: '新正文',
      context: 'body' as const,
    };

    await listener.handlePostMentionsUpdated(event);
    await listener.handlePostMentionsUpdated(event);

    expect(notificationProducer.notify).toHaveBeenCalledTimes(2);
    expect(notificationProducer.notify).toHaveBeenNthCalledWith(
      1,
      'mention',
      ['user2'],
      '作者 在编辑后的正文里提到了你：新正文',
      expect.objectContaining({
        postId: 'post-edited',
        eventKey: 'mention:post-edited',
      }),
    );
    expect(notificationProducer.notify.mock.calls[1][3]).toEqual(
      expect.objectContaining({ eventKey: 'mention:post-edited' }),
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
