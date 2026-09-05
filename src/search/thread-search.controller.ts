import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiServiceUnavailableResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { OptionalAuth } from '../auth/decorators/auth.decorator';
import { SearchPostsQueryDto } from './dto/search-query.dto';
import { SearchPostResponseDto } from './dto/search-response.dto';
import { SearchService } from './search.service';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';

/** 帖内搜索控制器：按主题帖访问权限搜索其全部子贴楼层。 */
@ApiTags('Search')
@Controller('threads/:threadId/search')
export class ThreadSearchController {
  constructor(private searchService: SearchService) {}

  @Get('posts')
  @ApiServiceUnavailableResponse({ description: '搜索超时，请缩小关键词范围后重试' })
  @OptionalAuth()
  @ApiOperation({ summary: '搜索帖内楼层与楼中楼；includeBody=true 同时搜索主贴和子贴正文' })
  @ApiCursorPaginatedResponse(
    SearchPostResponseDto,
    '相关度游标分页；搜索全部子贴，不限制单帖结果数量',
  )
  @ApiBadRequestResponse({ description: '关键词不足 2 个字符或游标无效' })
  @ApiNotFoundResponse({ description: '主题帖不存在，或当前用户无权访问私密帖' })
  async searchPosts(
    @Param('threadId') threadId: string,
    @Query() query: SearchPostsQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string } | undefined;
    return this.searchService.searchThreadPosts(
      threadId,
      query.q,
      query.cursor,
      query.limit,
      user?.id,
      query.includeBody,
    );
  }
}
