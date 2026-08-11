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
import { AdminAuthController } from './admin-auth.controller';
import { AdminAccountsController, AdminInviteAcceptanceController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminModerationAppealsController, ModerationCasesController, UserModerationAppealsController } from './moderation-cases.controller';
import { ModerationCasesService } from './moderation-cases.service';
import { SiteOperationalSettingsController } from './site-operational-settings.controller';
import { NotificationCampaignController } from './notification-campaign.controller';
import { NotificationCampaignService } from './notification-campaign.service';
import { AuthModule } from '../auth/auth.module';

/** 管理后台模块：系统通知发送、预览、历史、用户搜索 */
@Module({
  imports: [NotificationsModule, TagsModule, TaxonomyModule, AuthModule],
  controllers: [
    AdminAuthController,
    AdminAccountsController,
    AdminInviteAcceptanceController,
    ModerationCasesController,
    AdminModerationAppealsController,
    UserModerationAppealsController,
    SiteOperationalSettingsController,
    NotificationCampaignController,
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
    AdminAccountsService,
    ModerationCasesService,
    NotificationCampaignService,
  ],
  exports: [AdminPolicyService, AuditService, ModerationService],
})
export class AdminModule {}
