import { Module } from '@nestjs/common';
import { ThreadAccessService } from './thread-access.service';
import { BlockFilterService } from './block-filter.service';

/** 内容访问策略模块：显式导出主题访问与双向拉黑策略。 */
@Module({
  providers: [ThreadAccessService, BlockFilterService],
  exports: [ThreadAccessService, BlockFilterService],
})
export class AccessPolicyModule {}
