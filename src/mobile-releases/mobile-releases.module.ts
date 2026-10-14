import { Module } from '@nestjs/common';
import { AndroidDownloadsController } from './android-downloads.controller';
import { AndroidDownloadsService } from './android-downloads.service';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { AuditModule } from '../moderation/audit.module';
import {
  AdminMobileReleasesController,
  MobileReleasesController,
} from './mobile-releases.controller';
import { MobileReleasesService } from './mobile-releases.service';

@Module({
  imports: [AdminSecurityModule, AuditModule],
  controllers: [
    MobileReleasesController,
    AdminMobileReleasesController,
    AndroidDownloadsController,
  ],
  providers: [MobileReleasesService, AndroidDownloadsService],
})
export class MobileReleasesModule {}
