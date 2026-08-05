import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { Public } from '../common/decorators/public.decorator';
import { SearchResultResponseDto } from './dto/search-response.dto';

/** 全文搜索控制器：基于 PostgreSQL ILIKE */
@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  /** 搜索用户名、主题帖标题和楼层内容 */
  @Get()
  @Public()
  @ApiOperation({ summary: '全站搜索（用户名 + 主题帖标题 + 楼层内容）' })
  @ApiQuery({ name: 'q', description: '搜索关键词' })
  @ApiOkResponse({ type: SearchResultResponseDto, description: '搜索结果 { users, threads, posts }' })
  async search(@Query('q') q: string) {
    return this.searchService.search(q);
  }
}
