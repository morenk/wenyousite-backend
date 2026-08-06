import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationsModule } from '../notifications/notifications.module';

/** 管理后台模块：系统通知发送、预览、历史、用户搜索 */
@Module({
  imports: [NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
