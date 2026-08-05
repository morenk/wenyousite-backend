import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SearchService } from './search.service';
import { Public } from '../common/decorators/public.decorator';
import {
  SearchPostResponseDto,
  SearchResultResponseDto,
  SearchThreadResponseDto,
  SearchUserResponseDto,
} from './dto/search-response.dto';
import {
  SearchKeywordQueryDto,
  SearchPostsQueryDto,
} from './dto/search-query.dto';

/** 全站搜索控制器：分类端点供 Tab 按需加载，聚合端点兼容旧客户端。 */
@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get('threads')
  @Public()
  @ApiOperation({ summary: '按标题搜索公开主题帖' })
  @ApiOkResponse({ type: SearchThreadResponseDto, isArray: true, description: '主题帖结果，最多 50 条' })
  async searchThreads(@Query() query: SearchKeywordQueryDto) {
    return this.searchService.searchThreads(query.q);
  }

  @Get('users')
  @Public()
  @ApiOperation({ summary: '按用户名搜索未注销用户' })
  @ApiOkResponse({ type: SearchUserResponseDto, isArray: true, description: '用户结果，最多 20 条' })
  async searchUsers(@Query() query: SearchKeywordQueryDto) {
    return this.searchService.searchUsers(query.q);
  }

  @Get('posts')
  @Public()
  @ApiOperation({ summary: '按正文搜索公开楼层与楼中楼' })
  @ApiOkResponse({ type: SearchPostResponseDto, isArray: true, description: '相关度游标分页；meta 含 cursor/hasMore' })
  @ApiBadRequestResponse({ description: '关键词不足 2 个字符或游标无效' })
  async searchPosts(@Query() query: SearchPostsQueryDto) {
    return this.searchService.searchPosts(query.q, query.cursor, query.limit);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: '兼容聚合搜索（用户名 + 主题帖标题 + 楼层内容）' })
  @ApiOkResponse({ type: SearchResultResponseDto, description: '兼容旧客户端的聚合搜索结果' })
  async search(@Query() query: SearchKeywordQueryDto) {
    return this.searchService.search(query.q);
  }
}
