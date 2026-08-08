import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminPolicyService } from './admin-policy.service';
import { AuditService } from './audit.service';
import { ModerationService } from './moderation.service';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationQueryService } from './admin-moderation-query.service';

/** 管理后台模块：系统通知发送、预览、历史、用户搜索 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    AdminController,
    AdminModerationController,
  ],
  providers: [
    AdminService,
    AdminPolicyService,
    AuditService,
    ModerationService,
    AdminModerationQueryService,
  ],
  exports: [AdminPolicyService, AuditService, ModerationService],
})
export class AdminModule {}
