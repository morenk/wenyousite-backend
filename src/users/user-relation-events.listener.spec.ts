import { UserRelationEventsListener } from './user-relation-events.listener';
import type { NotificationProducer } from '../notifications/notification.producer';
import type { BlockFilterService } from '../access/block-filter.service';

describe('UserRelationEventsListener', () => {
  it('过滤拉黑关系后使用领域事件提供的幂等键通知', async () => {
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const blockFilter = {
      loadBlockSets: jest.fn().mockResolvedValue({}),
      filterRecipients: jest.fn().mockReturnValue(['target']),
    };
    const listener = new UserRelationEventsListener(
      notifications as unknown as NotificationProducer,
      blockFilter as unknown as BlockFilterService,
    );

    await listener.handleFollowed({
      actorId: 'actor',
      actorUsername: 'A',
      targetId: 'target',
      notificationEventKey: 'follow:actor:target:cycle-1',
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      'follow',
      ['target'],
      'A 关注了你',
      expect.objectContaining({ eventKey: 'follow:actor:target:cycle-1' }),
    );
  });
});
