import {
  Controller, Get, Post, Delete,
  Body, Param, Query, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiCreatedResponse, ApiUnauthorizedResponse, ApiConflictResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { BookmarksService } from './bookmarks.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { AuthRead } from '../auth/decorators/auth.decorator';

/** 收藏控制器：列表、添加、取消 */
@ApiTags('Bookmarks')
@Controller('bookmarks')
@AuthRead()
@ApiBearerAuth()
export class BookmarksController {
  constructor(private bookmarksService: BookmarksService) {}

  @Get()
  @ApiOperation({ summary: '我的收藏列表（Cursor 分页）' })
  @ApiOkResponse({ description: '我的收藏列表（cursor 分页，含帖子摘要）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async findAll(@Req() req: FastifyRequest, @Query() query: CursorPaginationDto) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.findAll(user.id, query.cursor, query.limit);
  }

  @Post()
  @ApiOperation({ summary: '收藏主题帖' })
  @ApiCreatedResponse({ description: '创建的收藏记录' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiConflictResponse({ description: '重复收藏' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async create(@Req() req: FastifyRequest, @Body() dto: CreateBookmarkDto) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.create(user.id, dto.threadId);
  }

  @Delete(':id')
  @ApiOperation({ summary: '取消收藏' })
  @ApiOkResponse({ description: '已取消收藏' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '收藏不存在' })
  async remove(@Req() req: FastifyRequest, @Param('id') id: string) {
    const user = req['user'] as { id: string };
    await this.bookmarksService.remove(id, user.id);
    return { message: '已取消收藏' };
  }
}
