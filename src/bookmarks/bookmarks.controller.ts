import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { DeleteBookmarkFolderResponseDto } from './dto/delete-bookmark-folder-response.dto';
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { BookmarksService } from './bookmarks.service';
import { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { OwnBookmarkThreadResponseDto } from '../threads/dto/thread-list-response.dto';
import { BookmarkResponseDto } from './dto/bookmark-response.dto';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import {
  BookmarkFolderResponseDto,
  BookmarkQueryDto,
  RenameBookmarkFolderDto,
  CreateBookmarkFolderDto,
  MoveBookmarkDto,
} from './dto/bookmark-folder.dto';

/** 收藏控制器：列表、添加、取消 */
@ApiTags('Bookmarks')
@Controller('bookmarks')
@ApiBearerAuth()
export class BookmarksController {
  constructor(private bookmarksService: BookmarksService) {}

  @Get()
  @AuthRead()
  @ApiOperation({ summary: '我的收藏列表（Cursor 分页）' })
  @ApiCursorPaginatedResponse(
    OwnBookmarkThreadResponseDto,
    '我的收藏列表（cursor 分页，含帖子摘要）',
  )
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async findAll(@Req() req: FastifyRequest, @Query() query: BookmarkQueryDto) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.findAll(user.id, query.cursor, query.limit, query.folderId);
  }

  @Get('folders')
  @AuthRead()
  @ApiOperation({ summary: '获取我的主题帖收藏夹分类' })
  @ApiOkResponse({ type: BookmarkFolderResponseDto, isArray: true })
  findFolders(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.findFolders(user.id);
  }

  @Post('folders')
  @Auth()
  @ApiOperation({ summary: '新建主题帖收藏夹分类' })
  @ApiCreatedResponse({ type: BookmarkFolderResponseDto })
  createFolder(@Req() req: FastifyRequest, @Body() dto: CreateBookmarkFolderDto) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.createFolder(user.id, dto.name);
  }

  @Patch('folders/:id')
  @Auth()
  @ApiOperation({ summary: '重命名自定义主题帖收藏夹' })
  @ApiOkResponse({ type: BookmarkFolderResponseDto })
  @ApiBadRequestResponse({ description: '名称 trim 后须为 1–24 个字符' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiForbiddenResponse({ description: '账号无写入权限' })
  @ApiNotFoundResponse({ description: '收藏夹不存在或不属于当前用户' })
  @ApiConflictResponse({ description: '默认夹不可修改、名称重复或并发冲突；刷新后重试' })
  renameFolder(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: RenameBookmarkFolderDto,
  ) {
    return this.bookmarksService.renameFolder(user.id, id, dto.name);
  }

  @Delete('folders/:id')
  @Auth()
  @ApiOperation({ summary: '删除自定义主题帖收藏夹并将全部收藏移入默认夹' })
  @ApiOkResponse({ type: DeleteBookmarkFolderResponseDto })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiForbiddenResponse({ description: '账号无写入权限' })
  @ApiNotFoundResponse({ description: '收藏夹不存在或不属于当前用户' })
  @ApiConflictResponse({ description: '默认夹不可删除或并发冲突；事务回滚，刷新后重试' })
  deleteFolder(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.bookmarksService.deleteFolder(user.id, id);
  }

  @Post()
  @Auth()
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
  @Auth()
  @ApiOperation({ summary: '移动收藏到其他收藏夹' })
  @ApiOkResponse({ type: BookmarkResponseDto })
  @ApiNotFoundResponse({ description: '收藏或收藏夹不存在' })
  move(@Req() req: FastifyRequest, @Param('id') id: string, @Body() dto: MoveBookmarkDto) {
    const user = req['user'] as { id: string };
    return this.bookmarksService.move(id, user.id, dto.folderId);
  }

  @Delete(':id')
  @Auth()
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
