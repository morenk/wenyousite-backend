import { HttpStatus, Injectable } from '@nestjs/common';
import { MobilePlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { RegisterMobileDeviceDto } from './dto/mobile-device.dto';

@Injectable()
export class MobileDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, sessionId: string | undefined, dto: RegisterMobileDeviceDto) {
    if (!sessionId) {
      throw new BusinessException(
        ErrorCode.SESSION_NOT_FOUND,
        '当前访问令牌未绑定移动登录终端，请重新登录',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const activeSession = await this.prisma.refreshToken.findFirst({
      where: {
        userId,
        family: sessionId,
        platform: 'mobile',
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!activeSession) {
      throw new BusinessException(
        ErrorCode.SESSION_NOT_FOUND,
        '当前移动登录终端已失效，请重新登录',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const platform = dto.platform === 'ios' ? MobilePlatform.IOS : MobilePlatform.ANDROID;
    const device = await this.prisma.$transaction(async (tx) => {
      await tx.mobileDevice.deleteMany({
        where: {
          pushToken: dto.pushToken,
          NOT: { userId, sessionId },
        },
      });
      return tx.mobileDevice.upsert({
        where: { userId_sessionId: { userId, sessionId } },
        create: {
          userId,
          sessionId,
          pushToken: dto.pushToken,
          platform,
          appVersion: dto.appVersion,
          locale: dto.locale,
        },
        update: {
          pushToken: dto.pushToken,
          platform,
          appVersion: dto.appVersion,
          locale: dto.locale,
          enabled: true,
          lastSeenAt: new Date(),
        },
      });
    });
    return this.toResponse(device);
  }

  async unregister(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.prisma.mobileDevice.updateMany({
        where: { userId, sessionId },
        data: { enabled: false },
      });
    }
    return { message: '当前移动终端推送已注销' };
  }

  async cleanupInactiveSessions() {
    const devices = await this.prisma.mobileDevice.findMany({
      where: { enabled: true },
      select: { id: true, userId: true, sessionId: true },
    });
    if (devices.length === 0) return 0;
    const active = await this.prisma.refreshToken.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        OR: devices.map((device) => ({ userId: device.userId, family: device.sessionId })),
      },
      select: { userId: true, family: true },
    });
    const activeKeys = new Set(active.map((session) => `${session.userId}:${session.family}`));
    const staleIds = devices
      .filter((device) => !activeKeys.has(`${device.userId}:${device.sessionId}`))
      .map((device) => device.id);
    if (staleIds.length === 0) return 0;
    const result = await this.prisma.mobileDevice.updateMany({
      where: { id: { in: staleIds } },
      data: { enabled: false },
    });
    return result.count;
  }

  private toResponse(device: {
    id: string;
    platform: MobilePlatform;
    appVersion: string | null;
    locale: string | null;
    enabled: boolean;
    lastSeenAt: Date;
  }) {
    return {
      id: device.id,
      platform: device.platform === MobilePlatform.IOS ? 'ios' as const : 'android' as const,
      appVersion: device.appVersion,
      locale: device.locale,
      enabled: device.enabled,
      lastSeenAt: device.lastSeenAt,
    };
  }
}
