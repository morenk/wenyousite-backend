import { ExperienceEventType } from '@prisma/client';
import { ExperienceEventsListener } from './experience-events.listener';

describe('ExperienceEventsListener', () => {
  const progression = { grant: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const listener = new ExperienceEventsListener(progression as never, notifications as never);

  beforeEach(() => jest.clearAllMocks());

  it('正文不计回复经验，楼层和楼中楼按 postId 幂等计入', async () => {
    await listener.handlePostCreated({ postId: 'body-1', userId: 'user-1', isSubthreadBody: true });
    expect(progression.grant).not.toHaveBeenCalled();

    await listener.handlePostCreated({ postId: 'post-1', userId: 'user-1' });
    expect(progression.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: ExperienceEventType.POST_CREATED,
        idempotencyKey: 'experience:post-created:post-1',
      }),
    );
  });

  it('自己点赞不计经验，其他用户首次点赞按双方和主题组合幂等', async () => {
    await listener.handleThreadLiked({
      threadId: 'thread-1',
      ownerId: 'owner-1',
      userId: 'owner-1',
    });
    expect(progression.grant).not.toHaveBeenCalled();

    await listener.handleThreadLiked({
      threadId: 'thread-1',
      ownerId: 'owner-1',
      userId: 'reader-1',
    });
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
