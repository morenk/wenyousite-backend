import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiCreatedResponse, ApiUnauthorizedResponse, ApiConflictResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { BookmarksService } from './bookmarks.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { AuthRead } from '../auth/decorators/auth.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { OwnBookmarkThreadResponseDto } from '../threads/dto/thread-list-response.dto';
import { BookmarkResponseDto } from './dto/bookmark-response.dto';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import {
  BookmarkFolderResponseDto,
  BookmarkQueryDto,
  CreateBookmarkFolderDto,
  MoveBookmarkDto,
} from './dto/bookmark-folder.dto';

/** 收藏控制器：列表、添加、取消 */
@ApiTags('Bookmarks')
@Controller('bookmarks')
@AuthRead()
@ApiBearerAuth()
export class BookmarksController {
  constructor(private bookmarksService: BookmarksService) {}

  @Get()
  @ApiOperation({ summary: '我的收藏列表（Cursor 分页）' })
  @ApiCursorPaginatedResponse(OwnBookmarkThreadResponseDto, '我的收藏列表（cursor 分页，含帖子摘要）')
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async findAll(@Req() req: FastifyRequest, @Query() query: BookmarkQueryDto) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.findAll(user.id, query.cursor, query.limit, query.folderId);
  }

  @Get('folders')
  @ApiOperation({ summary: '获取我的收藏夹分类' })
  @ApiOkResponse({ type: BookmarkFolderResponseDto, isArray: true })
  findFolders(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.findFolders(user.id);
  }

  @Post('folders')
  @ApiOperation({ summary: '新建收藏夹分类' })
  @ApiCreatedResponse({ type: BookmarkFolderResponseDto })
  createFolder(@Req() req: FastifyRequest, @Body() dto: CreateBookmarkFolderDto) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.createFolder(user.id, dto.name);
  }

  @Post()
  @ApiOperation({ summary: '收藏主题帖' })
  @ApiCreatedResponse({ type: BookmarkResponseDto, description: '创建的收藏记录' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiConflictResponse({ description: '重复收藏' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async create(@Req() req: FastifyRequest, @Body() dto: CreateBookmarkDto) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.create(user.id, dto.threadId, dto.folderId);
  }

  @Patch(':id')
  @ApiOperation({ summary: '移动收藏到其他收藏夹' })
  @ApiOkResponse({ type: BookmarkResponseDto })
  @ApiNotFoundResponse({ description: '收藏或收藏夹不存在' })
  move(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() dto: MoveBookmarkDto,
  ) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.move(id, user.id, dto.folderId);
  }

  @Delete(':id')
  @ApiOperation({ summary: '取消收藏' })
  @ApiOkResponse({ type: MessageResponseDto, description: '已取消收藏' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '收藏不存在' })
  async remove(@Req() req: FastifyRequest, @Param('id') id: string) {
    const user = req['user'] as { id: string };
    await this.bookmarksService.remove(id, user.id);
    return { message: '已取消收藏' };
  }
}
