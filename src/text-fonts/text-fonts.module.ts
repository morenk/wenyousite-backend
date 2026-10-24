import { FontSubmissionService } from './font-submission.service';
import { FontManagementService } from './font-management.service';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../moderation/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TextFontsV2Controller } from './text-fonts-v2.controller';
import { FontAdminService } from './font-admin.service';
import { FontQueueListener } from './font-queue.listener';
import { TextFontCoreModule } from './text-font-core.module';

@Module({
  imports: [
    TextFontCoreModule,
    AuditModule,
    OutboxModule,
    BullModule.registerQueue({ name: 'text-font' }),
  ],
  controllers: [TextFontsV2Controller],
  providers: [FontAdminService, FontQueueListener, FontSubmissionService, FontManagementService],
  exports: [FontAdminService, TextFontCoreModule, FontSubmissionService, FontManagementService],
})
export class TextFontsModule {}
