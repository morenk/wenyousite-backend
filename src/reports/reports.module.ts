import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AdminReportsController } from './reports.controller';
import { AdminModule } from '../admin/admin.module';

/** 举报模块 */
@Module({
  imports: [AdminModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
