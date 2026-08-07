import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { DirectMessagesService } from './direct-messages.service';
import { DirectMessageQueryService } from './direct-message-query.service';
import { DirectConversationQueryDto, DirectMessageQueryDto } from './dto/direct-conversation-query.dto';
import { HandleDirectRequestDto, SetDirectConversationArchiveDto } from './dto/direct-conversation-action.dto';
import {
  CreateDirectConversationDto,
  CreateDirectMessageDto,
  MarkDirectConversationReadDto,
} from './dto/direct-message.dto';
import {
  DirectConversationLookupResponseDto,
  DirectConversationResponseDto,
  DirectConversationStartResponseDto,
  DirectMessageRecallResponseDto,
  DirectMessageResponseDto,
  DirectUnreadCountResponseDto,
} from './dto/direct-message-response.dto';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';

@ApiTags('Direct Messages')
@ApiBearerAuth()
@Controller('direct-conversations')
export class DirectConversationsController {
  constructor(
    private readonly service: DirectMessagesService,
    private readonly queries: DirectMessageQueryService,
  ) {}

  @Get()
  @AuthRead()
  @ApiOperation({ summary: '私聊会话列表（主列表 / 消息请求 / 归档）' })
  @ApiCursorPaginatedResponse(DirectConversationResponseDto, '游标分页会话列表')
  async findAll(@Req() req: FastifyRequest, @Query() query: DirectConversationQueryDto) {
    const user = req.user as { id: string };
    return this.queries.findAll(user.id, query);
  }

  @Get('unread')
  @AuthRead()
  @ApiOperation({ summary: '私聊未读消息数与待处理请求数' })
  @ApiOkResponse({ type: DirectUnreadCountResponseDto })
  async unread(@Req() req: FastifyRequest) {
    const user = req.user as { id: string };
    return this.queries.unreadCount(user.id);
  }

  @Get('by-user/:userId')
  @AuthRead()
  @ApiOperation({ summary: '查询与指定用户的现有会话及可联系状态' })
  @ApiOkResponse({ type: DirectConversationLookupResponseDto })
  @ApiNotFoundResponse({ description: '目标用户不存在或已注销' })
  async findByUser(@Req() req: FastifyRequest, @Param('userId') otherUserId: string) {
    const user = req.user as { id: string };
    return this.queries.findByOtherUser(user.id, otherUserId);
  }

  @Post()
  @Auth()
  @ApiOperation({ summary: '向用户发送首条消息；互关直达，否则创建消息请求' })
  @ApiCreatedResponse({ type: DirectConversationStartResponseDto })
  @ApiForbiddenResponse({ description: '邮箱未验证、存在拉黑关系或无权再次申请' })
  @ApiConflictResponse({ description: '消息请求仍待处理或已被拒绝' })
  async create(@Req() req: FastifyRequest, @Body() dto: CreateDirectConversationDto) {
    const user = req.user as { id: string };
    return this.service.initiate(user.id, dto);
  }

  @Get(':id')
  @AuthRead()
  @ApiOperation({ summary: '私聊会话详情' })
  @ApiOkResponse({ type: DirectConversationResponseDto })
  @ApiNotFoundResponse({ description: '会话不存在或当前用户不是参与者' })
  async findById(@Req() req: FastifyRequest, @Param('id') id: string) {
    const user = req.user as { id: string };
    return this.queries.findById(id, user.id);
  }

  @Get(':id/messages')
  @AuthRead()
  @ApiOperation({ summary: '私聊消息历史或轮询增量；响应按时间正序' })
  @ApiCursorPaginatedResponse(DirectMessageResponseDto, '游标分页消息列表')
  @ApiNotFoundResponse({ description: '会话或消息游标不存在' })
  async messages(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Query() query: DirectMessageQueryDto,
  ) {
    const user = req.user as { id: string };
    return this.queries.findMessages(id, user.id, query);
  }

  @Post(':id/messages')
  @Auth()
  @ApiOperation({ summary: '向已接受的私聊会话发送消息' })
  @ApiCreatedResponse({ type: DirectMessageResponseDto })
  @ApiForbiddenResponse({ description: '邮箱未验证、拉黑或会话不可发送' })
  @ApiConflictResponse({ description: '请求待处理/已拒绝或图片已被使用' })
  async send(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() dto: CreateDirectMessageDto,
  ) {
    const user = req.user as { id: string };
    return this.service.send(id, user.id, dto);
  }

  @Patch(':id/request')
  @AuthRead()
  @ApiOperation({ summary: '接受或拒绝收到的消息请求；接受要求邮箱已验证' })
  @ApiOkResponse({ type: DirectConversationResponseDto })
  @ApiForbiddenResponse({ description: '不是请求接收方或接受时邮箱未验证' })
  async handleRequest(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() dto: HandleDirectRequestDto,
  ) {
    const user = req.user as { id: string; emailVerified: boolean };
    return this.service.handleRequest(id, user, dto.action);
  }

  @Patch(':id/archive')
  @AuthRead()
  @ApiOperation({ summary: '归档或恢复自己的会话' })
  @ApiOkResponse({ type: DirectConversationResponseDto })
  async archive(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() dto: SetDirectConversationArchiveDto,
  ) {
    const user = req.user as { id: string };
    return this.service.setArchived(id, user.id, dto.archived);
  }

  @Post(':id/read')
  @AuthRead()
  @ApiOperation({ summary: '标记当前用户实际看到的消息为已读，不向发件人暴露回执' })
  @ApiOkResponse({ type: MessageResponseDto })
  async markRead(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() dto: MarkDirectConversationReadDto,
  ) {
    const user = req.user as { id: string };
    return this.service.markRead(id, user.id, dto.throughMessageId);
  }
}

@ApiTags('Direct Messages')
@ApiBearerAuth()
@Controller('direct-messages')
export class DirectMessagesController {
  constructor(private readonly service: DirectMessagesService) {}

  @Delete(':id')
  @AuthRead()
  @ApiOperation({ summary: '发送者在 10 分钟内撤回消息；待处理首条消息会取消请求' })
  @ApiOkResponse({ type: DirectMessageRecallResponseDto })
  @ApiUnauthorizedResponse({ description: '未登录' })
  @ApiForbiddenResponse({ description: '不是发送者或消息当前不可撤回' })
  @ApiConflictResponse({ description: '已超过 10 分钟撤回时限' })
  async recall(@Req() req: FastifyRequest, @Param('id') id: string) {
    const user = req.user as { id: string };
    return this.service.recall(id, user.id);
  }
}
