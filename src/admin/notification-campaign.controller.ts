import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminAuth } from '../auth/decorators/admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AdminActor, AdminRole } from './admin-policy.service';
import {
  CreateNotificationCampaignDto,
  NotificationAudienceDto,
  NotificationCampaignQueryDto,
} from './dto/notification-campaign.dto';
import { NotificationCampaignService } from './notification-campaign.service';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import { AdminRecipientCountResponseDto } from './dto/admin-response.dto';
import { NotificationCampaignResponseDto } from './dto/admin-station-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';

function actorFrom(user: CurrentUserPayload): AdminActor {
  return { id: user.id, username: user.username, role: user.role as AdminRole };
}

@ApiTags('Admin Campaigns')
@Controller('admin/notification-campaigns')
@AdminAuth()
export class NotificationCampaignController {
  constructor(private readonly campaigns: NotificationCampaignService) {}

  @Get()
  @ApiOperation({ summary: '定时站内通知历史和状态' })
  @ApiCursorPaginatedResponse(NotificationCampaignResponseDto, '通知计划历史')
  list(@Query() query: NotificationCampaignQueryDto) {
    return this.campaigns.list(query);
  }

  @Post('preview')
  @ApiOperation({ summary: '预估通知接收人数' })
  @ApiOkResponse({ type: AdminRecipientCountResponseDto })
  preview(@Body() audience: NotificationAudienceDto) {
    return this.campaigns.preview(audience);
  }

  @Post()
  @ApiOperation({ summary: '新建立即或定时发送的站内通知' })
  @ApiCreatedResponse({ type: NotificationCampaignResponseDto })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateNotificationCampaignDto,
    @Req() request: FastifyRequest,
  ) {
    return this.campaigns.create(actorFrom(user), dto, { ip: request.ip, requestId: request.id });
  }

  @Delete(':id')
  @ApiOperation({ summary: '取消尚未开始发送的通知计划' })
  @ApiOkResponse({ type: MessageResponseDto })
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.campaigns.cancel(id, actorFrom(user), { ip: request.ip, requestId: request.id });
  }
}
