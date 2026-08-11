import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ThreadsService } from './threads.service';
import { CreateThreadDto } from './dto/create-thread.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';
import { InviteLinkResponseDto, InvitePreviewResponseDto } from './dto/invite-response.dto';
import { ThreadDetailResponseDto } from './dto/thread-detail-response.dto';
import {
  DraftThreadResponseDto,
  HomeThreadListItemResponseDto,
} from './dto/thread-list-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { SaveThreadAggregateDto } from './dto/save-thread-aggregate.dto';
import { ThreadAggregateService } from './thread-aggregate.service';
import {
  JoinedThreadMemberResponseDto,
  ThreadLikeResponseDto,
} from './dto/thread-action-response.dto';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';

/** 主题帖控制器：草稿箱、列表、详情、修改、发布、删除、点赞 */
@ApiTags('Threads')
@Controller('threads')
export class ThreadsController {
  constructor(
    private threadsService: ThreadsService,
    private threadAggregateService: ThreadAggregateService,
  ) {}

  @Get('draft')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '我的草稿箱列表（未发布帖，仅自己可见）' })
  @ApiOkResponse({ type: DraftThreadResponseDto, isArray: true, description: '草稿列表，每个含子贴标题和标签' })
  @ApiUnauthorizedResponse({ description: '未登录' })
  async findDrafts(@Req() req: FastifyRequest) {
    const user = req.user as { id: string };
    return this.threadsService.findDrafts(user.id);
  }

  @Get()
  @OptionalAuth()
  @ApiOperation({
    summary: '首页主题帖发现列表，排除已注销楼主的帖子',
    description:
      '仅返回楼主账号未注销的已发布主题帖，支持排序、分区、状态及标签筛选。已注销楼主的历史公开帖仅可通过显式搜索找到。',
  })
  @ApiCursorPaginatedResponse(
    HomeThreadListItemResponseDto,
    '分页列表，meta 含 cursor/hasMore。每个帖含 owner/subthreads/bodyPost.content(正文预览)/topicTags/_count',
  )
  async findAll(@Query() query: ThreadQueryDto, @Req() req: FastifyRequest) {
    const user = req.user as { id: string } | undefined;
    return this.threadsService.findAll(query, user?.id);
  }

  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({
    summary: '创建主题帖草稿（published=false）。在沙盒内逐步添加子贴/楼层后通过 PATCH 发布',
  })
  @ApiCreatedResponse({
    type: ThreadDetailResponseDto,
    description: '草稿创建成功，返回完整 Thread 对象（含正文待掷骰子）',
  })
  @ApiUnauthorizedResponse({ description: '未登录或邮箱未验证' })
  async create(@Body() dto: CreateThreadDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.create(dto, user.id);
  }

  @Get(':id')
  @OptionalAuth()
  @ApiOperation({ summary: '主题帖详情（含 全部子贴列表 + 楼层数 + 参与人数）' })
  @ApiOkResponse({
    type: ThreadDetailResponseDto,
    description: 'Thread 完整对象（含 bodyPost 的待掷与正式骰子结果）。viewCount 异步 +1',
  })
  @ApiNotFoundResponse({ description: '主题帖不存在或已删除（PRIVATE 帖非成员也返回 404）' })
  async findById(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string } | undefined;
    return this.threadsService.findById(id, user?.id);
  }

  @Patch(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({
    summary: '修改/发布主题帖（仅 OWNER/COLLABORATOR）。设置 published=true 发布，带乐观锁 version',
  })
  @ApiOkResponse({
    type: ThreadDetailResponseDto,
    description: '更新成功返回 Thread 完整对象。发布时原子结算全部待掷骰子',
  })
  @ApiUnauthorizedResponse({ description: '未登录或邮箱未验证' })
  @ApiForbiddenResponse({ description: '无管理权限（非 OWNER/COLLABORATOR）' })
  @ApiNotFoundResponse({ description: '主题帖不存在' })
  @ApiConflictResponse({ description: '乐观锁冲突（version 过期）或已发布帖重复发布' })
  async update(@Param('id') id: string, @Body() dto: UpdateThreadDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.update(id, dto, user.id);
  }

  @Patch(':id/aggregate')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({
    summary: '原子保存主题帖元数据、默认子贴标题/正文和标签，可同时发布草稿',
  })
  @ApiOkResponse({
    type: ThreadDetailResponseDto,
    description: '全部字段在同一事务内保存，返回最新完整主题帖',
  })
  @ApiUnauthorizedResponse({ description: '未登录或邮箱未验证' })
  @ApiForbiddenResponse({ description: '无管理权限或协作者尝试修改楼主专属字段' })
  @ApiNotFoundResponse({ description: '主题帖或默认子贴不存在' })
  @ApiConflictResponse({ description: '主题帖、默认子贴或正文乐观锁冲突' })
  async saveAggregate(
    @Param('id') id: string,
    @Body() dto: SaveThreadAggregateDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req.user as { id: string };
    return this.threadAggregateService.save(id, dto, user.id);
  }

  @Delete(':id')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除主题帖。未发布帖硬删除（级联），已发布帖软删除（仅 OWNER）' })
  @ApiOkResponse({ type: MessageResponseDto, description: '主题帖已删除' })
  @ApiUnauthorizedResponse({ description: '未登录或邮箱未验证' })
  @ApiForbiddenResponse({ description: '非 OWNER 不可删除' })
  @ApiNotFoundResponse({ description: '主题帖不存在' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.threadsService.remove(id, user.id);
    return { message: '主题帖已删除' };
  }

  /** 点赞主题帖 */
  @Post(':id/like')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '点赞主题帖（幂等，不通知自己）' })
  @ApiCreatedResponse({ type: ThreadLikeResponseDto, description: '主题帖 ID 与最新点赞数' })
  async like(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string; username: string };
    return this.threadsService.like(id, user.id, user.username);
  }

  /** 取消点赞主题帖 */
  @Delete(':id/like')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '取消点赞主题帖（幂等）' })
  @ApiOkResponse({ type: ThreadLikeResponseDto, description: '主题帖 ID 与最新点赞数' })
  async unlike(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.unlike(id, user.id);
  }

  @Post(':id/invite-link')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '生成或刷新私密帖邀请链接（仅 OWNER，需已发布 + 私密帖）' })
  @ApiOkResponse({ type: InviteLinkResponseDto, description: '邀请链接对象（threadId / token）。已存在则刷新 token' })
  @ApiUnauthorizedResponse({ description: '未登录或邮箱未验证' })
  @ApiForbiddenResponse({ description: '仅 OWNER / 未发布 / 非私密帖' })
  async createInviteLink(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.createInviteLink(id, user.id);
  }

  @Get('join-by-link/:token')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '预览邀请链接对应的私密帖信息，并判断当前用户是否已加入' })
  @ApiOkResponse({ type: InvitePreviewResponseDto, description: '帖子概要和 alreadyJoined 状态' })
  @ApiUnauthorizedResponse({ description: '未登录' })
  @ApiNotFoundResponse({ description: '邀请链接无效或已失效' })
  async previewInviteLink(@Param('token') token: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.previewInviteLink(token, user.id);
  }

  @Post('join-by-link/:token')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '通过 16 位邀请 token 幂等加入私密帖（需已发布）' })
  @ApiOkResponse({
    type: JoinedThreadMemberResponseDto,
    description: '加入成功或已加入时返回成员记录（thread.title / user 基本信息）',
  })
  @ApiUnauthorizedResponse({ description: '未登录或邮箱未验证' })
  @ApiNotFoundResponse({ description: '邀请链接无效或已失效' })
  async joinByInviteLink(@Param('token') token: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.threadsService.joinByInviteLink(token, user.id);
  }
}
