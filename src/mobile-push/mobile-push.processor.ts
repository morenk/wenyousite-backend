import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { FirebasePushProvider, MobilePushMessage } from './firebase-push.provider';
import { MobilePushJob } from './mobile-push.producer';

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

@Processor('mobile-push')
export class MobilePushProcessor extends WorkerHost {
  private readonly logger = new Logger(MobilePushProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: FirebasePushProvider,
  ) {
    super();
  }

  async process(job: Job<MobilePushJob>) {
    if (!this.provider.isEnabled()) return;
    const device = await this.prisma.mobileDevice.findFirst({
      where: { userId: job.data.userId, enabled: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!device) return;
    const activeSession = await this.prisma.refreshToken.findFirst({
      where: {
        userId: device.userId,
        family: device.sessionId,
        platform: 'mobile',
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!activeSession) {
      await this.prisma.mobileDevice.update({
        where: { id: device.id },
        data: { enabled: false },
      });
      return;
    }

    const pushMessage: MobilePushMessage = job.data.kind === 'notification'
      ? {
          token: device.pushToken,
          kind: 'notification',
          collapseKey: job.data.notificationId,
          data: { notificationId: job.data.notificationId },
        }
      : {
          token: device.pushToken,
          kind: 'direct_message',
          collapseKey: job.data.conversationId,
          data: {
            conversationId: job.data.conversationId,
            messageId: job.data.messageId,
          },
        };
    try {
      await this.provider.send(pushMessage);
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : '';
      if (INVALID_TOKEN_CODES.has(code)) {
        await this.prisma.mobileDevice.update({
          where: { id: device.id },
          data: { enabled: false },
        });
        this.logger.warn(`Disabled invalid mobile push token for device ${device.id}`);
        return;
      }
      throw error;
    }
  }
}
