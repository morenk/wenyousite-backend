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

const ownerManager = (userId = 'owner1', username = '楼主') => ({
  userId,
  role: 'OWNER',
  user: { username },
});

const collaboratorManager = (userId = 'collab1', username = '协作者') => ({
  userId,
  role: 'COLLABORATOR',
  user: { username },
});

describe('PostEventsListener 订阅过滤', () => {
  it('发帖者是楼主时只触发 THREAD 官方更新订阅', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
      { userId: 'sub_user', type: 'USER', targetUserId: 'author1' },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([ownerManager('author1', 'author1')]);

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
    expect(notificationProducer.notify).toHaveBeenCalledTimes(1);
  });

  it('协作者发表主楼层时楼主收到互动，THREAD 订阅者仍收到内容更新', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([
      ownerManager(),
      collaboratorManager('author1'),
    ]);

    await listener.handlePostCreated({
      ...baseEvent,
      authorRole: 'COLLABORATOR',
      authorPlayerMarked: false,
    });

    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['sub_thread'],
      'author1 发布了新楼层：测试内容',
      expect.any(Object),
    );
    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'reply',
      ['owner1'],
      'author1 回复了楼主：测试内容',
      expect.objectContaining({
        eventKey: 'reply:post1',
        payload: expect.objectContaining({
          action: 'reply',
          replyTargetUserId: 'owner1',
          replyTargetName: '楼主',
        }),
      }),
    );
  });

  it('普通玩家发表主楼层时楼主收到互动，其他管理者和 USER 订阅者收到内容更新', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'sub_thread', type: 'THREAD', targetUserId: null },
      { userId: 'sub_user', type: 'USER', targetUserId: 'author1' },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([ownerManager(), collaboratorManager()]);

    await listener.handlePostCreated(baseEvent);

    const newPostCall = notificationProducer.notify.mock.calls.find(
      (call: unknown[]) => call[0] === 'new_post',
    );
    expect(newPostCall?.[1]).toEqual(['collab1', 'sub_user']);
    expect(newPostCall?.[1]).not.toContain('owner1');
    expect(newPostCall?.[1]).not.toContain('sub_thread');
    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'reply',
      ['owner1'],
      'author1 回复了楼主：测试内容',
      expect.objectContaining({
        postId: 'post1',
        payload: expect.objectContaining({
          replyTargetUserId: 'owner1',
          replyTargetName: '楼主',
        }),
      }),
    );
  });

  it('主楼层显式提及楼主时 mention 优先且不再重复发送 reply', async () => {
    const { listener, notificationProducer, prisma, mentionsService } = buildListener();
    mentionsService.parseAndCreate.mockResolvedValue([{ userId: 'owner1' }]);
    prisma.threadMember.findMany.mockResolvedValue([ownerManager()]);

    await listener.handlePostCreated(baseEvent);

    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'mention',
      ['owner1'],
      expect.any(String),
      expect.any(Object),
    );
    expect(
      notificationProducer.notify.mock.calls.find((call: unknown[]) => call[0] === 'reply'),
    ).toBeUndefined();
  });

  it('子贴正文仍作为内容更新通知楼主，不改写为主题回复', async () => {
    const { listener, notificationProducer, prisma } = buildListener();
    prisma.threadMember.findMany.mockResolvedValue([ownerManager()]);

    await listener.handlePostCreated({ ...baseEvent, isSubthreadBody: true });

    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['owner1'],
      'author1 创建了新子贴「子贴」：测试内容',
      expect.any(Object),
    );
    expect(
      notificationProducer.notify.mock.calls.find((call: unknown[]) => call[0] === 'reply'),
    ).toBeUndefined();
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

  it('楼中楼把直接回复者与更新观察者按原因分流', async () => {
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
      ['target1'],
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
    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['owner1', 'subscriber1'],
      '科尔诺鹿雅 发布了楼中楼回复：测试内容',
      {
        postId: 'reply-post',
        threadId: 'thread1',
        fromUserId: 'author1',
        eventKey: 'new-reply:reply-post',
        payload: {
          actorName: '科尔诺鹿雅',
          action: 'new_reply',
          preview: '测试内容',
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

  it('楼主回复自己的楼层时仍通知其他管理者与 THREAD 订阅者', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'subscriber1', type: 'THREAD', targetUserId: null },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([
      { userId: 'author1' },
      { userId: 'collaborator1' },
    ]);
    prisma.post.findUnique.mockResolvedValue({
      authorId: 'author1',
      author: { username: 'author1' },
    });

    await listener.handlePostCreated({
      ...baseEvent,
      parentPostId: 'parent-post',
      authorRole: 'OWNER',
    });

    expect(notificationProducer.notify).toHaveBeenCalledTimes(1);
    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['collaborator1', 'subscriber1'],
      'author1 发布了楼中楼回复：测试内容',
      expect.objectContaining({
        eventKey: 'new-reply:post1',
        payload: expect.objectContaining({ action: 'new_reply' }),
      }),
    );
  });

  it('同一条回复显式提及后覆盖直接回复与订阅次级通知', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma, mentionsService } =
      buildListener();
    mentionsService.parseAndCreate.mockResolvedValue([{ userId: 'replyAuthor' }]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }]);
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'replyAuthor', type: 'USER', targetUserId: 'author1' },
    ]);
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
    const observerCall = notificationProducer.notify.mock.calls.find(
      (call: unknown[]) => call[0] === 'new_post',
    );
    expect(mentionCall?.[1]).toEqual(['replyAuthor']);
    expect(replyCall).toBeUndefined();
    expect(observerCall?.[1]).toEqual(['owner1']);
    expect(observerCall?.[3]).toEqual(
      expect.objectContaining({ payload: expect.objectContaining({ action: 'new_reply' }) }),
    );
  });

  it('直接回复者同时是管理者或订阅者时只收到互动通知', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'target1', type: 'THREAD', targetUserId: null },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([
      { userId: 'target1' },
      { userId: 'observer1' },
    ]);
    prisma.post.findUnique.mockResolvedValue({
      authorId: 'target1',
      author: { username: '目标用户' },
    });

    await listener.handlePostCreated({
      ...baseEvent,
      postId: 'reply-overlap',
      parentPostId: 'parent-post',
      authorRole: 'OWNER',
    });

    const callsForTarget = notificationProducer.notify.mock.calls.filter((call: unknown[]) =>
      (call[1] as string[]).includes('target1'),
    );
    expect(callsForTarget).toHaveLength(1);
    expect(callsForTarget[0][0]).toBe('reply');
    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['observer1'],
      expect.any(String),
      expect.objectContaining({ payload: expect.objectContaining({ action: 'new_reply' }) }),
    );
  });

  it('协作者楼中楼回复触发 THREAD 订阅更新', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'subscriber1', type: 'THREAD', targetUserId: null },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }, { userId: 'author1' }]);
    prisma.post.findUnique.mockResolvedValue({
      authorId: 'target1',
      author: { username: '目标用户' },
    });

    await listener.handlePostCreated({
      ...baseEvent,
      parentPostId: 'parent-post',
      authorRole: 'COLLABORATOR',
      authorPlayerMarked: false,
    });

    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['owner1', 'subscriber1'],
      expect.any(String),
      expect.objectContaining({ payload: expect.objectContaining({ action: 'new_reply' }) }),
    );
  });

  it('已标记玩家楼中楼回复触发对应 USER 订阅更新', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'player-subscriber', type: 'USER', targetUserId: 'author1' },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }]);
    prisma.post.findUnique.mockResolvedValue({
      authorId: 'target1',
      author: { username: '目标用户' },
    });

    await listener.handlePostCreated({
      ...baseEvent,
      parentPostId: 'parent-post',
      authorRole: 'PARTICIPANT',
      authorPlayerMarked: true,
    });

    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['owner1', 'player-subscriber'],
      expect.any(String),
      expect.objectContaining({ payload: expect.objectContaining({ action: 'new_reply' }) }),
    );
  });

  it('回复目标缺失时仍发送管理者与订阅者更新', async () => {
    const { listener, notificationProducer, subscriptionsService, prisma } = buildListener();
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'subscriber1', type: 'THREAD', targetUserId: null },
    ]);
    prisma.threadMember.findMany.mockResolvedValue([{ userId: 'owner1' }]);
    prisma.post.findUnique.mockResolvedValue(null);

    await listener.handlePostCreated({
      ...baseEvent,
      parentPostId: 'parent-post',
      authorRole: 'OWNER',
    });

    expect(notificationProducer.notify).toHaveBeenCalledTimes(1);
    expect(notificationProducer.notify).toHaveBeenCalledWith(
      'new_post',
      ['owner1', 'subscriber1'],
      expect.any(String),
      expect.objectContaining({ payload: expect.objectContaining({ action: 'new_reply' }) }),
    );
  });

  it('Outbox 重试复用完整提及快照，不降级为订阅通知', async () => {
    const { listener, notificationProducer, subscriptionsService, mentionsService } =
      buildListener();
    mentionsService.parseAndCreate.mockResolvedValue([{ userId: 'subscriber1' }]);
    subscriptionsService.findSubscribers.mockResolvedValue([
      { userId: 'subscriber1', type: 'THREAD', targetUserId: null },
    ]);
    notificationProducer.notify.mockRejectedValueOnce(new Error('database unavailable'));
    const loggerError = jest
      .spyOn(
        (listener as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(listener.handlePostCreated({ ...baseEvent, authorRole: 'OWNER' })).rejects.toThrow(
      'post.created event processing failed',
    );
    await listener.handlePostCreated({ ...baseEvent, authorRole: 'OWNER' });

    expect(mentionsService.parseAndCreate).toHaveBeenCalledTimes(2);
    const recipientCalls = notificationProducer.notify.mock.calls.filter((call: unknown[]) =>
      (call[1] as string[]).includes('subscriber1'),
    );
    expect(recipientCalls).toHaveLength(2);
    expect(recipientCalls.every((call: unknown[]) => call[0] === 'mention')).toBe(true);
    expect(recipientCalls[0][3]).toEqual(expect.objectContaining({ eventKey: 'mention:post1' }));
    expect(recipientCalls[1][3]).toEqual(expect.objectContaining({ eventKey: 'mention:post1' }));
    loggerError.mockRestore();
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
