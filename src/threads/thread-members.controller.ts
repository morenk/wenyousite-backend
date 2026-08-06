import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ThreadMembersService } from './thread-members.service';
import { UpdateMemberDto } from './dto/update-member.dto';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';

/** 主题帖参与人控制器：候选池加入、身份管理、退出 */
@ApiTags('Threads')
@Controller('threads/:threadId/members')
export class ThreadMembersController {
  constructor(private membersService: ThreadMembersService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: '获取主题帖参与人列表' })
  async findAll(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string } | undefined;
    return this.membersService.findAll(threadId, user?.id);
  }

  @Post('join')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '自由加入主题帖（兼容旧客户端，Web 已改为发言时自动参与）', deprecated: true })
  async join(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.membersService.join(threadId, user.id);
  }

  @Patch(':userId')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改参与人角色或玩家标记（仅 OWNER/COLLABORATOR）' })
  @ApiBody({
    schema: {
      properties: {
        role: { type: 'string', enum: ['COLLABORATOR', 'PARTICIPANT'] },
        playerMarked: { type: 'boolean' },
      },
    },
  })
  async updateMember(
    @Param('threadId') threadId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberDto,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.membersService.updateMember(threadId, targetUserId, dto, user.id);
  }

  @Delete('me')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '主动退出主题帖（取消自己的玩家标记）' })
  @ApiOkResponse({ type: MessageResponseDto, description: '已退出主题帖' })
  async exitMember(
    @Param('threadId') threadId: string,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    await this.membersService.exitMember(threadId, user.id);
    return { message: '已退出主题帖' };
  }

}
