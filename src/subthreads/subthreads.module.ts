import { Module } from '@nestjs/common';
import { SubthreadsController } from './subthreads.controller';
import { SubthreadsService } from './subthreads.service';
import { AccessPolicyModule } from '../access/access-policy.module';
import { OutboxModule } from '../outbox/outbox.module';

/** 子贴模块：CRUD、排序与发帖权限 */
@Module({
  imports: [AccessPolicyModule, OutboxModule],
  controllers: [SubthreadsController],
  providers: [SubthreadsService],
  exports: [SubthreadsService],
})
export class SubthreadsModule {}
