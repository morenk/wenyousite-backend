import { Module } from '@nestjs/common';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { AuditModule } from '../moderation/audit.module';
import {
  AdminMobileReleasesController,
  MobileReleasesController,
} from './mobile-releases.controller';
import { MobileReleasesService } from './mobile-releases.service';

@Module({
  imports: [AdminSecurityModule, AuditModule],
  controllers: [MobileReleasesController, AdminMobileReleasesController],
  providers: [MobileReleasesService],
})
export class MobileReleasesModule {}
