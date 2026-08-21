import { ExperienceEventType } from '@prisma/client';
import { ExperienceEventsListener } from './experience-events.listener';

describe('ExperienceEventsListener', () => {
  const progression = { grant: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const listener = new ExperienceEventsListener(progression as never, notifications as never);

  beforeEach(() => jest.clearAllMocks());

  const postEvent = (postId: string, isSubthreadBody = false) => ({
    postId,
    content: 'content',
    userId: 'user-1',
    threadId: 'thread-1',
    subthreadId: 'subthread-1',
    subthreadTitle: 'title',
    parentPostId: null,
    replyToPostId: null,
    isSubthreadBody,
    authorRole: 'PARTICIPANT' as const,
    authorPlayerMarked: false,
  });

  const likedEvent = (userId: string) => ({
    eventId: 'event-1',
    threadId: 'thread-1',
    ownerId: 'owner-1',
    threadTitle: 'title',
    userId,
    username: 'reader',
  });

  it('正文不计回复经验，楼层和楼中楼按 postId 幂等计入', async () => {
    await listener.handlePostCreated(postEvent('body-1', true));
    expect(progression.grant).not.toHaveBeenCalled();

    await listener.handlePostCreated(postEvent('post-1'));
    expect(progression.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: ExperienceEventType.POST_CREATED,
        idempotencyKey: 'experience:post-created:post-1',
      }),
    );
  });

  it('自己点赞不计经验，其他用户首次点赞按双方和主题组合幂等', async () => {
    await listener.handleThreadLiked(likedEvent('owner-1'));
    expect(progression.grant).not.toHaveBeenCalled();

    await listener.handleThreadLiked(likedEvent('reader-1'));
    expect(progression.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ExperienceEventType.THREAD_LIKED,
        idempotencyKey: 'experience:thread-liked:thread-1:reader-1',
      }),
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
