import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ExperienceEventsListener } from './experience-events.listener';
import { ProgressionService } from './progression.service';

@Module({
  imports: [OutboxModule, NotificationsModule],
  providers: [ProgressionService, ExperienceEventsListener],
  exports: [ProgressionService],
})
export class ProgressionModule {}
