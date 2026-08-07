import { ConfigService } from '@nestjs/config';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { FirebasePushProvider } from './firebase-push.provider';

const mockMessagingSend = jest.fn();

jest.mock('firebase-admin/app', () => ({
  applicationDefault: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ send: mockMessagingSend })),
}));

describe('FirebasePushProvider', () => {
  const config = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) => ({
      'push.enabled': false,
      'push.firebaseProjectId': 'project-1',
    })[key]);
    (getApps as jest.Mock).mockReturnValue([]);
    (applicationDefault as jest.Mock).mockReturnValue({ credential: 'default' });
    mockMessagingSend.mockResolvedValue('message-id');
  });

  it('能力关闭时不初始化 Firebase', () => {
    const provider = new FirebasePushProvider(config as unknown as ConfigService);

    provider.onModuleInit();

    expect(provider.isEnabled()).toBe(false);
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it('首次启用时使用应用默认凭据初始化指定项目', () => {
    config.get.mockImplementation((key: string) => ({
      'push.enabled': true,
      'push.firebaseProjectId': 'project-1',
    })[key]);
    const provider = new FirebasePushProvider(config as unknown as ConfigService);
    const loggerLog = jest.spyOn(
      (provider as unknown as { logger: { log: (...args: unknown[]) => void } }).logger,
      'log',
    ).mockImplementation(() => undefined);

    provider.onModuleInit();

    expect(provider.isEnabled()).toBe(true);
    expect(initializeApp).toHaveBeenCalledWith({
      credential: { credential: 'default' },
      projectId: 'project-1',
    });
    expect(loggerLog).toHaveBeenCalledWith('Firebase mobile push provider enabled');
  });

  it('已有 Firebase app 时不重复初始化', () => {
    config.get.mockImplementation((key: string) => key === 'push.enabled' ? true : 'project-1');
    (getApps as jest.Mock).mockReturnValue([{ name: '[DEFAULT]' }]);
    const provider = new FirebasePushProvider(config as unknown as ConfigService);
    jest.spyOn(
      (provider as unknown as { logger: { log: (...args: unknown[]) => void } }).logger,
      'log',
    ).mockImplementation(() => undefined);

    provider.onModuleInit();

    expect(initializeApp).not.toHaveBeenCalled();
  });

  it('关闭时 send 直接返回且不访问 Messaging', async () => {
    const provider = new FirebasePushProvider(config as unknown as ConfigService);
    provider.onModuleInit();

    await provider.send({
      token: 'secret-token',
      kind: 'notification',
      collapseKey: 'notification-1',
      data: { notificationId: 'notification-1' },
    });

    expect(getMessaging).not.toHaveBeenCalled();
  });

  it.each([
    ['notification', '你有一条新通知'],
    ['direct_message', '你有一条新私聊消息'],
  ] as const)('发送 %s 时只携带最小导航数据', async (kind, body) => {
    config.get.mockImplementation((key: string) => key === 'push.enabled' ? true : 'project-1');
    (getApps as jest.Mock).mockReturnValue([{ name: '[DEFAULT]' }]);
    const provider = new FirebasePushProvider(config as unknown as ConfigService);
    jest.spyOn(
      (provider as unknown as { logger: { log: (...args: unknown[]) => void } }).logger,
      'log',
    ).mockImplementation(() => undefined);
    provider.onModuleInit();

    await provider.send({
      token: 'secret-token',
      kind,
      collapseKey: 'conversation-1',
      data: { conversationId: 'conversation-1' },
    });

    expect(mockMessagingSend).toHaveBeenCalledWith({
      token: 'secret-token',
      notification: { title: '温油站', body },
      data: {
        schemaVersion: '1',
        kind,
        conversationId: 'conversation-1',
      },
      android: { collapseKey: 'conversation-1' },
      apns: { headers: { 'apns-collapse-id': 'conversation-1' } },
    });
  });
});
