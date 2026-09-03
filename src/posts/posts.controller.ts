import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { UpsertBodyDto } from './dto/upsert-body.dto';
import { PostQueryDto } from './dto/post-query.dto';
import { Auth, OptionalAuth } from '../auth/decorators/auth.decorator';
import {
  DiscussionAuthorResponseDto,
  FloorResponseDto,
  LatestThreadPostResponseDto,
  PostDetailResponseDto,
  PostResponseDto,
  ReplyResponseDto,
} from './dto/post-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import { ReplyOrder, ReplyQueryDto } from '../common/dto/reply-query.dto';

/** 楼层控制器：发帖、楼中楼、编辑、删除 */
@ApiTags('Posts')
@Controller()
export class PostsController {
  constructor(private postsService: PostsService) {}

  @Get('threads/:threadId/posts/latest')
  @OptionalAuth()
  @ApiOperation({ summary: '定位主题帖内最新发布的楼层或楼中楼回复' })
  @ApiOkResponse({
    type: LatestThreadPostResponseDto,
    description: '跨全部存活子贴、按创建时间定位的最新有效发言',
  })
  @ApiNotFoundResponse({ description: '主题帖不可访问，或主题帖内暂无有效楼层/回复' })
  async findLatestInThread(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    const user = req.user as { id: string } | undefined;
    return this.postsService.findLatestInThread(threadId, user?.id);
  }

  @Get('subthreads/:subthreadId/posts')
  @OptionalAuth()
  @ApiOperation({ summary: '获取子贴的楼层列表（Cursor 分页）' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标' })
  @ApiQuery({ name: 'limit', required: false, description: '每页条数' })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: ReplyOrder,
    description: '主楼层顺序，默认 OLDEST',
  })
  @ApiCursorPaginatedResponse(FloorResponseDto, '楼层列表（含楼中楼内联回复），cursor 分页')
  async findFloors(
    @Param('subthreadId') subthreadId: string,
    @Query() query: PostQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req.user as { id: string } | undefined;
    return this.postsService.findAllBySubthread(
      subthreadId,
      query.cursor,
      query.limit,
      user?.id,
      query.order ?? ReplyOrder.OLDEST,
      query.authorId,
    );
  }

  @Get('subthreads/:subthreadId/posts/authors')
  @OptionalAuth()
  @ApiOperation({ summary: '获取当前子贴中实际发布过主楼层的角色作者候选' })
  @ApiOkResponse({ type: DiscussionAuthorResponseDto, isArray: true })
  async findFloorAuthors(
    @Param('subthreadId') subthreadId: string,
    @Req() req: FastifyRequest,
  ) {
    const user = req.user as { id: string } | undefined;
    return this.postsService.findFloorAuthors(subthreadId, user?.id);
  }

  @Get('posts/:id/replies')
  @OptionalAuth()
  @ApiOperation({ summary: '获取楼中楼回复列表（支持顺序与玩家/楼主/协作者筛选）' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标（上一页最后一条记录 ID）' })
  @ApiQuery({ name: 'limit', required: false, description: '每页条数（默认 20，最大 50）' })
  @ApiCursorPaginatedResponse(
    ReplyResponseDto,
    '楼中楼回复列表（平级挂载，含 replyToPostId 追踪回复目标），cursor 分页',
  )
  async findReplies(
    @Param('id') id: string,
    @Query() query: ReplyQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req.user as { id: string } | undefined;
    return this.postsService.findReplies(
      id,
      query.cursor,
      query.limit,
      user?.id,
      query.order ?? ReplyOrder.OLDEST,
      query.authorId,
    );
  }

  @Get('posts/:id/replies/authors')
  @OptionalAuth()
  @ApiOperation({ summary: '获取当前楼层下实际回复过的角色作者候选' })
  @ApiOkResponse({ type: DiscussionAuthorResponseDto, isArray: true })
  async findReplyAuthors(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req.user as { id: string } | undefined;
    return this.postsService.findReplyAuthors(id, user?.id);
  }

  @Put('subthreads/:subthreadId/body')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({
    summary: '写入子贴正文（upsert：无正文创建，有正文乐观锁更新）。仅 OWNER/COLLABORATOR',
  })
  @ApiOkResponse({ type: PostResponseDto, description: '正文帖子（kind=BODY，不占楼层号）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiForbiddenResponse({ description: '无管理权限' })
  @ApiNotFoundResponse({ description: '子贴不存在' })
  async upsertBody(
    @Param('subthreadId') subthreadId: string,
    @Body() dto: UpsertBodyDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.postsService.upsertBody(subthreadId, dto.content, dto.version, user.id);
  }

  @Post('subthreads/:subthreadId/posts')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '发帖（创建新楼层或楼中楼回复）' })
  @ApiCreatedResponse({
    type: PostResponseDto,
    description: '创建的帖子（含楼层号或 parentPostId）',
  })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiBadRequestResponse({
    description: '回复目标缺少父楼层，或回复目标与父楼层不属于同一主楼层',
  })
  @ApiForbiddenResponse({ description: '无发帖权限（未加入子贴或权限不足）' })
  @ApiConflictResponse({ description: 'clientRequestId 已用于不同发帖载荷' })
  async create(
    @Param('subthreadId') subthreadId: string,
    @Body() dto: CreatePostDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.postsService.create(subthreadId, dto, user.id);
  }

  @Get('posts/:id')
  @OptionalAuth()
  @ApiOperation({ summary: '获取帖子详情' })
  @ApiOkResponse({ type: PostDetailResponseDto, description: '帖子详情（含作者和导航上下文）' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req.user as { id: string } | undefined;
    return this.postsService.findById(id, user?.id);
  }

  @Patch('posts/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '编辑帖子' })
  @ApiOkResponse({ type: PostResponseDto, description: '更新后的帖子' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiForbiddenResponse({ description: '非本人帖子，无权编辑' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async update(@Param('id') id: string, @Body() dto: UpdatePostDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.postsService.update(id, dto, user.id);
  }

  @Post('posts/:id/pin')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '将主楼层置顶到所属子贴' })
  @ApiOkResponse({ type: MessageResponseDto, description: '楼层已置顶' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiBadRequestResponse({ description: '仅支持置顶主楼层，或当前子贴置顶数量已达上限' })
  @ApiForbiddenResponse({ description: '仅楼主或协作者可置顶' })
  @ApiNotFoundResponse({ description: '楼层不存在或当前不可访问' })
  async pin(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.postsService.pin(id, user.id);
    return { message: '楼层已置顶' };
  }

  @Delete('posts/:id/pin')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消主楼层在所属子贴的置顶' })
  @ApiOkResponse({ type: MessageResponseDto, description: '楼层已取消置顶' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiBadRequestResponse({ description: '仅支持取消主楼层置顶' })
  @ApiForbiddenResponse({ description: '仅楼主或协作者可取消置顶' })
  @ApiNotFoundResponse({ description: '楼层不存在或当前不可访问' })
  async unpin(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.postsService.unpin(id, user.id);
    return { message: '楼层已取消置顶' };
  }

  @Delete('posts/:id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '软删除楼层（子贴正文 kind=BODY 不可删除）' })
  @ApiOkResponse({ type: MessageResponseDto, description: '帖子已删除' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiForbiddenResponse({ description: '非本人帖子，无权删除' })
  @ApiNotFoundResponse({ description: '帖子不存在' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.postsService.remove(id, user.id);
    return { message: '帖子已删除' };
  }
}
