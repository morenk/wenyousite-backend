import { Module } from '@nestjs/common';
import { SubthreadsController } from './subthreads.controller';
import { SubthreadTagsController } from './subthread-tags.controller';
import { SubthreadsService } from './subthreads.service';
import { SubthreadTagsService } from './subthread-tags.service';
import { AccessPolicyModule } from '../access/access-policy.module';
import { OutboxModule } from '../outbox/outbox.module';

/** 子贴模块：CRUD、排序、标签 */
@Module({
  imports: [AccessPolicyModule, OutboxModule],
  controllers: [SubthreadsController, SubthreadTagsController],
  providers: [SubthreadsService, SubthreadTagsService],
  exports: [SubthreadsService],
})
export class SubthreadsModule {}
