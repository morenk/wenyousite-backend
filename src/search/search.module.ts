import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ThreadSearchController } from './thread-search.controller';

/** 全文搜索模块 */
@Module({
  controllers: [SearchController, ThreadSearchController],
  providers: [SearchService],
})
export class SearchModule {}
