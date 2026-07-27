import { Module } from '@nestjs/common';
import { MentionsService } from './mentions.service';

/** @提及模块：正文解析与关联 */
@Module({
  providers: [MentionsService],
  exports: [MentionsService],
})
export class MentionsModule {}
