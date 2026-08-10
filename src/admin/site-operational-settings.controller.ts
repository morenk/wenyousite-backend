import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminAuth, SuperAdminStepUpAuth } from '../auth/decorators/admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AdminActor, AdminRole } from './admin-policy.service';
import { UpdateSiteSettingsDto } from './dto/site-settings.dto';
import { SiteOperationalSettingsService } from './site-operational-settings.service';
import { SiteOperationalSettingsResponseDto } from './dto/admin-station-response.dto';

function actorFrom(user: CurrentUserPayload): AdminActor {
  return { id: user.id, username: user.username, role: user.role as AdminRole };
}

@ApiTags('Admin Operations')
@Controller('admin/operations/settings')
export class SiteOperationalSettingsController {
  constructor(private readonly settings: SiteOperationalSettingsService) {}

  @Get()
  @AdminAuth()
  @ApiOperation({ summary: '读取注册、内容写入和维护公告状态' })
  @ApiOkResponse({ type: SiteOperationalSettingsResponseDto })
  get() {
    return this.settings.get();
  }

  @Patch()
  @SuperAdminStepUpAuth()
  @ApiOperation({ summary: '更新紧急开关和定时维护公告' })
  @ApiOkResponse({ type: SiteOperationalSettingsResponseDto })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateSiteSettingsDto,
    @Req() request: FastifyRequest,
  ) {
    return this.settings.update(actorFrom(user), dto, { ip: request.ip, requestId: request.id });
  }
}
