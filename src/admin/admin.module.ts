import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminModerationController } from './admin-moderation.controller';
import { TagsModule } from '../tags/tags.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { AdminTaxonomyController } from './admin-taxonomy.controller';
import { AdminTaxonomyService } from './admin-taxonomy.service';
import { AdminAuthController } from './admin-auth.controller';
import {
  AdminAccountsController,
  AdminInviteAcceptanceController,
} from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import {
  AdminModerationAppealsController,
  ModerationCasesController,
  UserModerationAppealsController,
} from './moderation-cases.controller';
import { SiteOperationalSettingsController } from './site-operational-settings.controller';
import { NotificationCampaignController } from './notification-campaign.controller';
import { NotificationCampaignService } from './notification-campaign.service';
import { AdminSecurityModule } from './admin-security.module';
import { AuditModule } from './audit.module';
import { ModerationModule } from './moderation.module';
import { OperationalSettingsModule } from './operational-settings.module';
import { ClientContentModerationController } from './client-content-moderation.controller';
import { AuthModule } from '../auth/auth.module';

/** 管理后台模块：系统通知发送、预览、历史、用户搜索 */
@Module({
  imports: [
    NotificationsModule,
    TagsModule,
    TaxonomyModule,
    AdminSecurityModule,
    AuditModule,
    ModerationModule,
    OperationalSettingsModule,
    AuthModule,
  ],
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
    ClientContentModerationController,
    AdminDashboardController,
    AdminTaxonomyController,
  ],
  providers: [
    AdminService,
    AdminDashboardService,
    AdminTaxonomyService,
    AdminAccountsService,
    NotificationCampaignService,
  ],
})
export class AdminModule {}
