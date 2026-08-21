import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminSecurityModule } from './admin-security.module';
import { AuditModule } from '../moderation/audit.module';
import { OperationalSettingsGuard } from './guards/operational-settings.guard';
import { SiteOperationalSettingsService } from './site-operational-settings.service';

/** 站点紧急开关及其全局写入保护。 */
@Module({
  imports: [AdminSecurityModule, AuditModule],
  providers: [
    SiteOperationalSettingsService,
    { provide: APP_GUARD, useClass: OperationalSettingsGuard },
  ],
  exports: [SiteOperationalSettingsService],
})
export class OperationalSettingsModule {}
