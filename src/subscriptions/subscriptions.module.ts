import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { AccessPolicyModule } from '../access/access-policy.module';
import { SubscriptionsService } from './subscriptions.service';

/** 订阅模块：玩家可订阅特定用户或整个主题帖 */
@Module({
  imports: [AccessPolicyModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
