import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** 全文搜索模块 */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
