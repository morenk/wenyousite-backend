import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminPolicyService } from './admin-policy.service';
import { AuditService } from './audit.service';
import { ModerationService } from './moderation.service';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminModerationQueryService } from './admin-moderation-query.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { TagsModule } from '../tags/tags.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { AdminTaxonomyController } from './admin-taxonomy.controller';
import { AdminTaxonomyService } from './admin-taxonomy.service';

/** 管理后台模块：系统通知发送、预览、历史、用户搜索 */
@Module({
  imports: [NotificationsModule, TagsModule, TaxonomyModule],
  controllers: [
    AdminController,
    AdminModerationController,
    AdminDashboardController,
    AdminTaxonomyController,
  ],
  providers: [
    AdminService,
    AdminPolicyService,
    AuditService,
    ModerationService,
    AdminModerationQueryService,
    AdminDashboardService,
    AdminTaxonomyService,
  ],
  exports: [AdminPolicyService, AuditService, ModerationService],
})
export class AdminModule {}
