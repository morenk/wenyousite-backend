import { Module } from '@nestjs/common';
import { MomentsModule } from '../moments/moments.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ThreadSearchController } from './thread-search.controller';
import { AccessPolicyModule } from '../access/access-policy.module';

/** 全文搜索模块 */
@Module({
  imports: [AccessPolicyModule, MomentsModule],
  controllers: [SearchController, ThreadSearchController],
  providers: [SearchService],
})
export class SearchModule {}
