import { ExperienceEventType } from '@prisma/client';
import { ExperienceEventsListener } from './experience-events.listener';

describe('ExperienceEventsListener', () => {
  const progression = { grantMany: jest.fn().mockResolvedValue([]) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const listener = new ExperienceEventsListener(progression as never, notifications as never);
  const occurredAt = '2026-08-08T12:00:00.000Z';

  beforeEach(() => jest.clearAllMocks());

  const postEvent = (overrides: Record<string, unknown> = {}) => ({
    postId: 'post-1',
    content: 'content',
    userId: 'user-1',
    threadId: 'thread-1',
    threadOwnerId: 'owner-1',
    threadVisibility: 'PUBLIC' as const,
    subthreadId: 'subthread-1',
    subthreadTitle: 'title',
    parentPostId: null,
    replyToPostId: null,
    isSubthreadBody: false,
    authorRole: 'PARTICIPANT' as const,
    authorPlayerMarked: false,
    occurredAt,
    ...overrides,
  });

  const likedEvent = (userId: string) => ({
    eventId: 'event-1',
    threadId: 'thread-1',
    ownerId: 'owner-1',
    threadTitle: 'title',
    userId,
    username: 'reader',
    occurredAt,
  });

  it('正文不计回复经验，普通回复合并日活、作者和楼主加成', async () => {
    await listener.handlePostCreated(postEvent({ postId: 'body-1', isSubthreadBody: true }));
    expect(progression.grantMany).not.toHaveBeenCalled();

    await listener.handlePostCreated(postEvent());
    const grants = progression.grantMany.mock.calls[0][0];
    expect(grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-1',
          type: ExperienceEventType.DAILY_CHECK_IN,
          idempotencyKey: 'experience:daily-activity:user-1:2026-08-08',
        }),
        expect.objectContaining({
          userId: 'user-1',
          type: ExperienceEventType.POST_CREATED,
          idempotencyKey: 'experience:post-created:post-1',
        }),
        expect.objectContaining({
          userId: 'owner-1',
          type: ExperienceEventType.THREAD_REPLY_RECEIVED,
          idempotencyKey: 'experience:thread-reply-received:owner-1:user-1:2026-08-08',
        }),
      ]),
    );
  });

  it('公开主题发布立即奖励，私帖只先领取日活', async () => {
    await listener.handleThreadPublished({
      threadId: 'public-thread',
      ownerId: 'owner-1',
      ownerUsername: 'owner',
      visibility: 'PUBLIC',
      occurredAt,
    });
    expect(progression.grantMany.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: ExperienceEventType.DAILY_CHECK_IN }),
        expect.objectContaining({ type: ExperienceEventType.THREAD_PUBLISHED }),
      ]),
    );

    await listener.handleThreadPublished({
      threadId: 'private-thread',
      ownerId: 'owner-2',
      ownerUsername: 'owner',
      visibility: 'PRIVATE',
      occurredAt,
    });
    expect(progression.grantMany.mock.calls[1][0]).toEqual([
      expect.objectContaining({ userId: 'owner-2', type: ExperienceEventType.DAILY_CHECK_IN }),
    ]);
  });

  it('私帖首个其他成员回复才结算开贴经验', async () => {
    await listener.handlePostCreated(
      postEvent({
        postId: 'private-post-1',
        threadId: 'private-thread',
        threadVisibility: 'PRIVATE',
        userId: 'member-1',
      }),
    );
    expect(progression.grantMany.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: ExperienceEventType.POST_CREATED }),
        expect.objectContaining({ type: ExperienceEventType.THREAD_REPLY_RECEIVED }),
        expect.objectContaining({ type: ExperienceEventType.PRIVATE_THREAD_ACTIVATED }),
      ]),
    );
  });

  it('自己点赞不计经验，其他用户点赞只为点赞者领取日活', async () => {
    await listener.handleThreadLiked(likedEvent('owner-1'));
    expect(progression.grantMany).not.toHaveBeenCalled();

    await listener.handleThreadLiked(likedEvent('reader-1'));
    expect(progression.grantMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'reader-1', type: ExperienceEventType.DAILY_CHECK_IN }),
        expect.objectContaining({
          userId: 'owner-1',
          type: ExperienceEventType.THREAD_LIKED,
          idempotencyKey: 'experience:thread-liked:thread-1:reader-1',
        }),
      ]),
    );
  });

  it('动态发布和动态回复都参与经验结算', async () => {
    await listener.handleMomentCreated({ momentId: 'moment-1', authorId: 'author-1', occurredAt });
    expect(progression.grantMany.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: ExperienceEventType.DAILY_CHECK_IN }),
        expect.objectContaining({ type: ExperienceEventType.MOMENT_PUBLISHED }),
      ]),
    );

    await listener.handleMomentCommentCreated({
      commentId: 'comment-1',
      momentId: 'moment-1',
      momentTitle: '动态',
      actorId: 'commenter-1',
      actorUsername: '评论者',
      recipientId: 'author-1',
      momentAuthorId: 'author-1',
      isReply: false,
      occurredAt,
    });
    expect(progression.grantMany.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: ExperienceEventType.MOMENT_COMMENT_CREATED }),
        expect.objectContaining({
          userId: 'author-1',
          type: ExperienceEventType.MOMENT_REPLY_RECEIVED,
          idempotencyKey: 'experience:moment-reply-received:author-1:commenter-1:2026-08-08',
        }),
      ]),
    );
  });

  it('动态作者自己回复不产生动态回复经验', async () => {
    await listener.handleMomentCommentCreated({
      commentId: 'comment-1',
      momentId: 'moment-1',
      momentTitle: '动态',
      actorId: 'author-1',
      actorUsername: '作者',
      recipientId: 'commenter-1',
      momentAuthorId: 'author-1',
      isReply: true,
      occurredAt,
    });
    expect(progression.grantMany).not.toHaveBeenCalled();
  });

  it('打赏合并投喂者日活、投喂和收款经验，并按双方每日去重', async () => {
    await listener.handleTipCompleted({
      transactionId: 'transaction-1',
      senderId: 'sender-1',
      senderUsername: '打赏者',
      recipientId: 'recipient-1',
      targetType: 'USER',
      grossAmount: '10',
      recipientAmount: '8',
      platformAmount: '2',
      occurredAt,
    });
    const grants = progression.grantMany.mock.calls[0][0];
    expect(grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'sender-1', type: ExperienceEventType.DAILY_CHECK_IN }),
        expect.objectContaining({
          userId: 'sender-1',
          type: ExperienceEventType.TIP_SENT,
          idempotencyKey: 'experience:tip-sent:sender-1:recipient-1:2026-08-08',
        }),
        expect.objectContaining({
          userId: 'recipient-1',
          type: ExperienceEventType.TIP_RECEIVED,
          idempotencyKey: 'experience:tip-received:recipient-1:sender-1:2026-08-08',
        }),
      ]),
    );
  });

  it('升级事件生成站内与移动端共用通知', async () => {
    await listener.handleLevelUp({ userId: 'user-1', previousLevel: 1, level: 2, experience: 52 });
    expect(notifications.notify).toHaveBeenCalledWith(
      'level_up',
      ['user-1'],
      '恭喜你升级到 Lv.2',
      expect.objectContaining({ eventKey: 'level-up:user-1:2:52' }),
    );
  });
});
