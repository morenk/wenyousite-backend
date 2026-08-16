import { Module } from '@nestjs/common';
import { AdminModerationQueryService } from './admin-moderation-query.service';
import { AdminPolicyService } from './admin-policy.service';
import { AuditModule } from './audit.module';
import { ModerationCasesService } from './moderation-cases.service';
import { ModerationService } from './moderation.service';

/** 内容治理命令、查询、案件与申诉能力。 */
@Module({
  imports: [AuditModule],
  providers: [
    AdminPolicyService,
    ModerationService,
    AdminModerationQueryService,
    ModerationCasesService,
  ],
  exports: [
    AdminPolicyService,
    ModerationService,
    AdminModerationQueryService,
    ModerationCasesService,
  ],
})
export class ModerationModule {}
