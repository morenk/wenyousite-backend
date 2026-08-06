import { Module } from '@nestjs/common';
import { MentionsService } from './mentions.service';
import { AccessPolicyModule } from '../access/access-policy.module';

/** @提及模块：正文解析与关联 */
@Module({
  imports: [AccessPolicyModule],
  providers: [MentionsService],
  exports: [MentionsService],
})
export class MentionsModule {}
