import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { OptionalAuth } from '../auth/decorators/auth.decorator';
import { SearchPostsQueryDto } from './dto/search-query.dto';
import { SearchPostResponseDto } from './dto/search-response.dto';
import { SearchService } from './search.service';

/** 帖内搜索控制器：按主题帖访问权限搜索其全部子贴楼层。 */
@ApiTags('Search')
@Controller('threads/:threadId/search')
export class ThreadSearchController {
  constructor(private searchService: SearchService) {}

  @Get('posts')
  @OptionalAuth()
  @ApiOperation({ summary: '按正文搜索单个主题帖内的楼层与楼中楼' })
  @ApiOkResponse({
    type: SearchPostResponseDto,
    isArray: true,
    description: '相关度游标分页；搜索全部子贴，不限制单帖结果数量',
  })
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
    );
  }
}
