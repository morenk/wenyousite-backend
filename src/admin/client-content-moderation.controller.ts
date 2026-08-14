import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminBearerAuth } from '../auth/decorators/admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AdminActor, AdminRole } from './admin-policy.service';
import { AdminContentParamsDto, ModerateContentDto } from './dto/moderation.dto';
import { AdminContentModerationResponseDto } from './dto/moderation-response.dto';
import { ModerationService } from './moderation.service';

function actorFrom(user: CurrentUserPayload): AdminActor {
  return { id: user.id, username: user.username, role: user.role as AdminRole };
}

@ApiTags('Client Moderation')
@Controller('moderation/content')
export class ClientContentModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post(':type/:id/hide')
  @AdminBearerAuth()
  @ApiOperation({ summary: '管理员在前台或移动端直接隐藏内容，无需独立站务会话' })
  @ApiOkResponse({ type: AdminContentModerationResponseDto })
  hide(
    @Param() params: AdminContentParamsDto,
    @Body() dto: ModerateContentDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.moderation.hideContent(
      actorFrom(user),
      params.type.toUpperCase() as 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT',
      params.id,
      dto.reason,
      { ip: request.ip, requestId: request.id },
    );
  }
}
