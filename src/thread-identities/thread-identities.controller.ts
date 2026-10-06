import { Body, Controller, Header, Delete, Get, Param, Patch, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Auth, AuthRead, OptionalAuth } from '../auth/decorators/auth.decorator';
import { ThreadIdentitiesService } from './thread-identities.service';
import {
  SetThreadIdentityEnabledDto,
  ThreadIdentitySettingsDto,
  ThreadIdentityStateDto,
  UpdateThreadIdentityDto,
} from './thread-identity.dto';
@ApiTags('Threads')
@Controller('threads/:threadId')
export class ThreadIdentitiesController {
  constructor(private readonly identities: ThreadIdentitiesService) {}
  @Header('Cache-Control', 'private, no-store')
  @Get('identity')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '读取自己的帖内身份与发言确认 token' })
  @ApiOkResponse({ type: ThreadIdentityStateDto })
  mine(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    return this.identities.state(threadId, req.user!.id, req.user!.id);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('identities/:userId')
  @OptionalAuth()
  @ApiOperation({ summary: '读取可访问主题内的当前身份卡与真实账号' })
  @ApiOkResponse({ type: ThreadIdentityStateDto })
  findUser(
    @Param('threadId') threadId: string,
    @Param('userId') userId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.identities.state(threadId, userId, req.user?.id);
  }
  @Put('identity')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '设置自己的帖内身份；仅影响之后的新发言' })
  @ApiOkResponse({ type: ThreadIdentityStateDto })
  update(
    @Param('threadId') threadId: string,
    @Req() req: FastifyRequest,
    @Body() dto: UpdateThreadIdentityDto,
  ) {
    return this.identities.update(threadId, req.user!.id, dto);
  }
  @Delete('identity')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '清除自己的当前帖内资料；保留历史发言身份' })
  @ApiOkResponse({ type: ThreadIdentityStateDto })
  clear(@Param('threadId') threadId: string, @Req() req: FastifyRequest) {
    return this.identities.update(threadId, req.user!.id, { nickname: null, avatarMediaId: null });
  }
  @Patch('identity-settings')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '楼主开启或关闭全帖身份展示；不删除历史资料' })
  @ApiOkResponse({ type: ThreadIdentitySettingsDto })
  setEnabled(
    @Param('threadId') threadId: string,
    @Req() req: FastifyRequest,
    @Body() dto: SetThreadIdentityEnabledDto,
  ) {
    return this.identities.setEnabled(threadId, req.user!.id, dto.enabled);
  }
}
