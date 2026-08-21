import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AdminReportsController } from './reports.controller';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { AuditModule } from '../moderation/audit.module';
import { ModerationModule } from '../moderation/moderation.module';

/** 举报模块 */
@Module({
  imports: [AdminSecurityModule, AuditModule, ModerationModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
