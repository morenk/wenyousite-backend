import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ThreadSearchController } from './thread-search.controller';
import { AccessPolicyModule } from '../access/access-policy.module';

/** 全文搜索模块 */
@Module({
  imports: [AccessPolicyModule],
  controllers: [SearchController, ThreadSearchController],
  providers: [SearchService],
})
export class SearchModule {}
