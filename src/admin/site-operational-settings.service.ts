import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AuditService } from './audit.service';
import { AdminActor } from './admin-policy.service';
import { AdminRequestContext } from './moderation.service';
import { UpdateSiteSettingsDto } from './dto/site-settings.dto';

@Injectable()
export class SiteOperationalSettingsService {
  private cached:
    | { expiresAt: number; registrationPausedUntil: Date | null; contentWritesPausedUntil: Date | null }
    | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get() {
    return this.prisma.siteOperationalSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  }

  async assertRequestAllowed(path: string, method: string) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
    const settings = await this.pauseState();
    const now = new Date();
    if (
      path.startsWith('/api/v1/auth/register/') &&
      settings.registrationPausedUntil &&
      settings.registrationPausedUntil > now
    ) {
      throw new BusinessException(
        ErrorCode.REGISTRATION_PAUSED,
        `注册暂时关闭至 ${settings.registrationPausedUntil.toISOString()}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const contentPrefixes = [
      '/api/v1/threads',
      '/api/v1/subthreads',
      '/api/v1/posts',
      '/api/v1/drafts',
      '/api/v1/moments',
      '/api/v1/direct-messages',
      '/api/v1/media',
      '/api/v1/stickers',
      '/api/v1/tags',
    ];
    if (
      contentPrefixes.some((prefix) => path.startsWith(prefix)) &&
      settings.contentWritesPausedUntil &&
      settings.contentWritesPausedUntil > now
    ) {
      throw new BusinessException(
        ErrorCode.CONTENT_WRITES_PAUSED,
        `内容写入暂时关闭至 ${settings.contentWritesPausedUntil.toISOString()}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async update(
    actor: AdminActor,
    dto: UpdateSiteSettingsDto,
    context: AdminRequestContext,
  ) {
    this.assertMaintenanceWindow(dto);
    const data = {
      ...(dto.registrationPausedUntil !== undefined
        ? { registrationPausedUntil: dto.registrationPausedUntil ? new Date(dto.registrationPausedUntil) : null }
        : {}),
      ...(dto.contentWritesPausedUntil !== undefined
        ? { contentWritesPausedUntil: dto.contentWritesPausedUntil ? new Date(dto.contentWritesPausedUntil) : null }
        : {}),
      ...(dto.maintenanceTitle !== undefined ? { maintenanceTitle: dto.maintenanceTitle?.trim() || null } : {}),
      ...(dto.maintenanceContent !== undefined ? { maintenanceContent: dto.maintenanceContent?.trim() || null } : {}),
      ...(dto.maintenanceStartsAt !== undefined
        ? { maintenanceStartsAt: dto.maintenanceStartsAt ? new Date(dto.maintenanceStartsAt) : null }
        : {}),
      ...(dto.maintenanceEndsAt !== undefined
        ? { maintenanceEndsAt: dto.maintenanceEndsAt ? new Date(dto.maintenanceEndsAt) : null }
        : {}),
    };
    const result = await this.prisma.$transaction(async (tx) => {
      const settings = await tx.siteOperationalSettings.upsert({
        where: { id: 'default' },
        create: { id: 'default', ...data },
        update: data,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: AuditAction.SITE_SETTINGS_UPDATED,
          targetType: AuditTargetType.SITE_SETTINGS,
          targetId: 'default',
          metadata: { changedFields: Object.keys(data), actorUsername: actor.username },
          ...context,
        },
        tx,
      );
      return settings;
    });
    this.cached = undefined;
    return result;
  }

  private async pauseState() {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached;
    const settings = await this.get();
    this.cached = {
      expiresAt: Date.now() + 5_000,
      registrationPausedUntil: settings.registrationPausedUntil,
      contentWritesPausedUntil: settings.contentWritesPausedUntil,
    };
    return this.cached;
  }

  private assertMaintenanceWindow(dto: UpdateSiteSettingsDto) {
    if (dto.maintenanceStartsAt && dto.maintenanceEndsAt) {
      if (new Date(dto.maintenanceStartsAt) >= new Date(dto.maintenanceEndsAt)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '维护结束时间必须晚于开始时间');
      }
    }
  }
}
