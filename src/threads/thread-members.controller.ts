import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ThreadMembersService } from './thread-members.service';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';

/** 主题帖成员控制器：加入、管理、踢出 */
@ApiTags('Threads')
@Controller('threads/:threadId/members')
export class ThreadMembersController {
  constructor(private membersService: ThreadMembersService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '获取主题帖成员列表' })
  async findAll(@Param('threadId') threadId: string) {
    return this.membersService.findAll(threadId);
  }

  @Post('join')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '用户自由加入主题帖' })
  async join(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.membersService.join(threadId, user.id);
  }

  @Post()
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '邀请用户加入（仅 OWNER/COLLABORATOR）' })
  @ApiBody({ schema: { properties: { userId: { type: 'string' } } } })
  async invite(
    @Param('threadId') threadId: string,
    @Body('userId') targetUserId: string,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.membersService.invite(threadId, targetUserId, user.id);
  }

  @Patch(':userId')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改成员角色或玩家标记（仅 OWNER/COLLABORATOR）' })
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
    @Body() dto: { role?: string; playerMarked?: boolean },
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.membersService.updateMember(threadId, targetUserId, dto, user.id);
  }

  @Delete(':userId')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '踢出成员（仅 OWNER/COLLABORATOR）' })
  async removeMember(
    @Param('threadId') threadId: string,
    @Param('userId') targetUserId: string,
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    await this.membersService.removeMember(threadId, targetUserId, user.id);
    return { message: '成员已移除' };
  }
}
