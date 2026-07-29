import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JobsModule } from '../jobs/jobs.module';

/** 管理后台模块 */
@Module({
  imports: [JobsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
