import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CursorPaginationDto } from '../common/dto/pagination.dto';
import { ReplyOrder, ReplyQueryDto } from '../common/dto/reply-query.dto';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import { MomentCommentsService } from './moment-comments.service';
import { MomentFeedQueryDto } from './dto/moment-query.dto';
import {
  MomentActionResponseDto,
  MomentCardResponseDto,
  MomentCommentContextResponseDto,
  MomentCommentResponseDto,
  MomentDeleteResponseDto,
  MomentDetailResponseDto,
  MomentRootCommentResponseDto,
} from './dto/moment-response.dto';
import { CreateMomentCommentDto, CreateMomentDto, UpdateMomentDto } from './dto/moment-write.dto';
import {
  CreateMomentBookmarkFolderDto,
  CreateMomentBookmarkDto,
  MomentBookmarkFolderResponseDto,
  MomentBookmarkPlacementResponseDto,
  MomentBookmarkQueryDto,
  MoveMomentBookmarkDto,
  OwnMomentBookmarkResponseDto,
} from './dto/moment-bookmark.dto';
import { MomentBookmarksService } from './moment-bookmarks.service';
import { MomentsService } from './moments.service';
import { PostAuthorResponseDto } from '../posts/dto/post-response.dto';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Moments')
@Controller('moments')
export class MomentsController {
  constructor(
    private readonly moments: MomentsService,
    private readonly bookmarksService: MomentBookmarksService,
    private readonly comments: MomentCommentsService,
  ) {}

  @Get()
  @OptionalAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '动态瀑布流；发现为热度，新鲜关注为时间倒序' })
  @ApiCursorPaginatedResponse(MomentCardResponseDto, '动态卡片游标分页')
  list(@Query() query: MomentFeedQueryDto, @CurrentUser() user?: CurrentUserPayload) {
    return this.moments.list(query.feed, query.cursor, query.limit, user);
  }

  @Get('bookmarks')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前用户收藏的动态' })
  @ApiCursorPaginatedResponse(OwnMomentBookmarkResponseDto, '动态收藏游标分页，含私有收藏夹 ID')
  bookmarks(@Query() query: MomentBookmarkQueryDto, @CurrentUser() user: CurrentUserPayload) {
    return this.bookmarksService.listMine(query.cursor, query.limit, user, query.folderId);
  }

  @Get('bookmark-folders')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取我的动态收藏夹分类' })
  @ApiOkResponse({ type: MomentBookmarkFolderResponseDto, isArray: true })
  bookmarkFolders(@CurrentUser() user: CurrentUserPayload) {
    return this.bookmarksService.listFolders(user.id);
  }

  @Post('bookmark-folders')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '新建动态收藏夹分类' })
  @ApiCreatedResponse({ type: MomentBookmarkFolderResponseDto })
  createBookmarkFolder(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateMomentBookmarkFolderDto,
  ) {
    return this.bookmarksService.createFolder(user.id, dto.name);
  }

  @Post()
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '发布纯文本/图片动态，最多 9 张图片' })
  @ApiCreatedResponse({ type: MomentDetailResponseDto })
  @ApiBadRequestResponse({ description: '标题、正文、封面或图片状态不合法' })
  @ApiConflictResponse({ description: '幂等键复用或图片已被使用' })
  create(@Body() dto: CreateMomentDto, @CurrentUser() user: CurrentUserPayload) {
    return this.moments.create(dto, user);
  }

  @Get(':id')
  @OptionalAuth()
  @ApiOperation({ summary: '获取动态详情' })
  @ApiOkResponse({ type: MomentDetailResponseDto })
  @ApiNotFoundResponse({ description: '动态不存在、已删除或因拉黑不可见' })
  detail(@Param('id') id: string, @CurrentUser() user?: CurrentUserPayload) {
    return this.moments.findById(id, user);
  }

  @Patch(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '编辑自己的动态，使用 version 乐观锁' })
  @ApiOkResponse({ type: MomentDetailResponseDto })
  @ApiConflictResponse({ description: '版本冲突或图片已被其他动态使用' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMomentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.moments.update(id, dto, user);
  }

  @Delete(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '软删除动态' })
  @ApiOkResponse({ type: MomentDeleteResponseDto })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.moments.remove(id, user);
  }

  @Post(':id/like')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '点赞动态，幂等' })
  @ApiCreatedResponse({ type: MomentActionResponseDto })
  like(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.moments.setLike(id, user, true);
  }

  @Delete(':id/like')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消点赞动态，幂等' })
  @ApiOkResponse({ type: MomentActionResponseDto })
  unlike(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.moments.setLike(id, user, false);
  }

  @Post(':id/bookmark')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '收藏动态，幂等' })
  @ApiBody({ type: CreateMomentBookmarkDto, required: false })
  @ApiCreatedResponse({ type: MomentActionResponseDto })
  bookmark(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto?: CreateMomentBookmarkDto,
  ) {
    return this.bookmarksService.set(id, user, true, dto?.folderId);
  }

  @Patch(':id/bookmark')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '移动动态收藏到其他收藏夹' })
  @ApiOkResponse({ type: MomentBookmarkPlacementResponseDto })
  @ApiNotFoundResponse({ description: '动态、收藏或收藏夹不存在' })
  moveBookmark(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: MoveMomentBookmarkDto,
  ) {
    return this.bookmarksService.move(id, user.id, dto.folderId);
  }

  @Delete(':id/bookmark')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消收藏动态，幂等' })
  @ApiOkResponse({ type: MomentActionResponseDto })
  unbookmark(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.bookmarksService.set(id, user, false);
  }

  @Get(':id/comments')
  @OptionalAuth()
  @ApiOperation({ summary: '主评论列表，支持顺序与作者筛选并内嵌最早三条楼中楼' })
  @ApiCursorPaginatedResponse(MomentRootCommentResponseDto, '主评论游标分页')
  commentsList(
    @Param('id') id: string,
    @Query() query: ReplyQueryDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.comments.listRoots(
      id,
      query.cursor,
      query.limit,
      user,
      query.order ?? ReplyOrder.NEWEST,
      query.authorId,
    );
  }

  @Get(':id/comment-authors')
  @OptionalAuth()
  @ApiOperation({ summary: '获取当前可见动态回复串中的作者候选' })
  @ApiOkResponse({ type: PostAuthorResponseDto, isArray: true })
  commentAuthors(@Param('id') id: string, @CurrentUser() user?: CurrentUserPayload) {
    return this.comments.listAuthors(id, user);
  }

  @Post(':id/comments')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '发表文字、单图或单表情评论；回复统一归入两层楼中楼' })
  @ApiCreatedResponse({ type: MomentCommentResponseDto })
  createComment(
    @Param('id') id: string,
    @Body() dto: CreateMomentCommentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.comments.create(id, dto, user);
  }

  @Get(':id/comments/:commentId/context')
  @OptionalAuth()
  @ApiOperation({ summary: '按评论 ID 获取动态主评论与精确定位目标' })
  @ApiOkResponse({ type: MomentCommentContextResponseDto })
  @ApiNotFoundResponse({ description: '动态或目标评论不存在、已删除或因拉黑不可见' })
  commentContext(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.comments.findContext(id, commentId, user);
  }

  @Get(':id/comments/:commentId/replies')
  @OptionalAuth()
  @ApiOperation({ summary: '分页获取某主评论的楼中楼，支持顺序与作者筛选' })
  @ApiCursorPaginatedResponse(MomentCommentResponseDto, '楼中楼游标分页')
  replies(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Query() query: ReplyQueryDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.comments.listReplies(
      id,
      commentId,
      query.cursor,
      query.limit,
      user,
      query.order ?? ReplyOrder.OLDEST,
      query.authorId,
    );
  }

  @Delete(':id/comments/:commentId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '评论作者、动态作者或管理员软删除评论' })
  @ApiOkResponse({ type: MomentDeleteResponseDto })
  @ApiForbiddenResponse({ description: '无删除权限' })
  removeComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.comments.remove(id, commentId, user);
  }
}

@ApiTags('Moments')
@Controller('users')
export class UserMomentsController {
  constructor(private readonly moments: MomentsService) {}

  @Get(':id/moments')
  @OptionalAuth()
  @ApiOperation({ summary: '用户公开动态列表' })
  @ApiCursorPaginatedResponse(MomentCardResponseDto, '用户动态游标分页')
  list(
    @Param('id') id: string,
    @Query() query: CursorPaginationDto,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.moments.listUserMoments(id, query.cursor, query.limit, user);
  }
}
