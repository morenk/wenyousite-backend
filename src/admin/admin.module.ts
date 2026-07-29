import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JobsModule } from '../jobs/jobs.module';

/** 管理后台模块：系统通知发送、预览、历史、用户搜索 */
@Module({
  imports: [JobsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
