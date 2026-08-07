import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { FirebasePushProvider } from './firebase-push.provider';
import { MobilePushProcessor } from './mobile-push.processor';
import { MobilePushJob } from './mobile-push.producer';

function build() {
  const prisma = {
    mobileDevice: { findFirst: jest.fn(), update: jest.fn() },
    refreshToken: { findFirst: jest.fn() },
  };
  const provider = { isEnabled: jest.fn().mockReturnValue(true), send: jest.fn() };
  return {
    processor: new MobilePushProcessor(
      prisma as unknown as PrismaService,
      provider as unknown as FirebasePushProvider,
    ),
    prisma,
    provider,
  };
}

const job = {
  data: {
    userId: 'u1',
    kind: 'direct_message',
    eventKey: 'direct-message:m1',
    conversationId: 'c1',
    messageId: 'm1',
  },
} as Job<MobilePushJob>;

describe('MobilePushProcessor', () => {
  it('能力关闭时不读取 token 或访问 Firebase', async () => {
    const { processor, prisma, provider } = build();
    provider.isEnabled.mockReturnValue(false);

    await processor.process(job);

    expect(prisma.mobileDevice.findFirst).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('仅向活跃 mobile family 发送最小导航数据', async () => {
    const { processor, prisma, provider } = build();
    prisma.mobileDevice.findFirst.mockResolvedValue({
      id: 'd1', userId: 'u1', sessionId: 'f1', pushToken: 'secret-token',
    });
    prisma.refreshToken.findFirst.mockResolvedValue({ id: 'r1' });

    await processor.process(job);

    expect(provider.send).toHaveBeenCalledWith({
      token: 'secret-token',
      kind: 'direct_message',
      collapseKey: 'c1',
      data: { conversationId: 'c1', messageId: 'm1' },
    });
  });

  it('登录终端已退出时停用设备且不发送', async () => {
    const { processor, prisma, provider } = build();
    prisma.mobileDevice.findFirst.mockResolvedValue({
      id: 'd1', userId: 'u1', sessionId: 'f1', pushToken: 'secret-token',
    });
    prisma.refreshToken.findFirst.mockResolvedValue(null);

    await processor.process(job);

    expect(prisma.mobileDevice.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { enabled: false },
    });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('Firebase 判定 token 无效时永久停用，瞬时错误继续抛出重试', async () => {
    const { processor, prisma, provider } = build();
    prisma.mobileDevice.findFirst.mockResolvedValue({
      id: 'd1', userId: 'u1', sessionId: 'f1', pushToken: 'secret-token',
    });
    prisma.refreshToken.findFirst.mockResolvedValue({ id: 'r1' });
    provider.send.mockRejectedValueOnce({ code: 'messaging/registration-token-not-registered' });

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(prisma.mobileDevice.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { enabled: false },
    });

    provider.send.mockRejectedValueOnce(new Error('network down'));
    await expect(processor.process(job)).rejects.toThrow('network down');
  });
});
