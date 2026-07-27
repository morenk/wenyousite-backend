import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { Public } from '../common/decorators/public.decorator';

/** 全文搜索控制器：基于 PostgreSQL ILIKE */
@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  /** 搜索主题帖标题 + 楼层内容，各最多 50 条 */
  @Get()
  @Public()
  @ApiOperation({ summary: '全文搜索（主题帖标题 + 楼层内容）' })
  @ApiQuery({ name: 'q', description: '搜索关键词' })
  async search(@Query('q') q: string) {
    return this.searchService.search(q);
  }
}
