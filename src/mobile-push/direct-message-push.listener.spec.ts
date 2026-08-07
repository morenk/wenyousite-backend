import { mock } from 'jest-mock-extended';
import { MobilePushProducer } from './mobile-push.producer';
import { DirectMessagePushListener } from './direct-message-push.listener';

describe('DirectMessagePushListener', () => {
  it('把私聊事件转换为不含消息正文的最小推送任务', async () => {
    const pushes = mock<MobilePushProducer>();
    const listener = new DirectMessagePushListener(pushes);

    await listener.handle({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      recipientId: 'user-2',
    });

    expect(pushes.enqueue).toHaveBeenCalledWith({
      userId: 'user-2',
      kind: 'direct_message',
      eventKey: 'direct-message:message-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
    });
  });
});
