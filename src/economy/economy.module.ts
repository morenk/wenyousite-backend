import { Module } from '@nestjs/common';
import { AccessPolicyModule } from '../access/access-policy.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ProgressionModule } from '../progression/progression.module';
import { RedisModule } from '../redis/redis.module';
import { EconomyController } from './economy.controller';
import { EconomyEventsListener } from './economy-events.listener';
import { EconomyService } from './economy.service';

@Module({
  imports: [AccessPolicyModule, NotificationsModule, OutboxModule, ProgressionModule, RedisModule],
  controllers: [EconomyController],
  providers: [EconomyService, EconomyEventsListener],
  exports: [EconomyService],
})
export class EconomyModule {}
