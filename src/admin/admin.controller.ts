import { Controller, Get, Post, Body, Req, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AdminService } from './admin.service';
import { SendSystemNotificationDto } from './dto/send-system-notification.dto';
import { AdminAuth } from './admin-auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AdminPolicyService, AdminRole } from '../moderation/admin-policy.service';
import {
  AdminRecipientCountResponseDto,
  AdminSystemNotificationHistoryResponseDto,
  AdminUserSearchResponseDto,
} from './dto/admin-response.dto';
import { AdminCapabilityResponseDto } from './dto/moderation-response.dto';

/** 管理后台控制器：系统通知发送、预览、历史、用户搜索 */
@ApiTags('Admin')
@Controller('admin')
@AdminAuth()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly policy: AdminPolicyService,
  ) {}

  /** 返回当前管理员的角色派生能力，不维护第二套 RBAC 数据。 */
  @Get()
  @ApiOperation({ summary: '当前管理员能力' })
  @ApiOkResponse({ type: AdminCapabilityResponseDto })
  index(@CurrentUser() user: CurrentUserPayload) {
    const role = user.role as AdminRole;
    return { role, capabilities: this.policy.capabilities(role) };
  }

  /** 发送系统通知（管理员） */
  @Post('notifications/system')
  @ApiOperation({ summary: '发送系统通知（管理员，手动指定 / 条件筛选 / 全站广播）' })
  @ApiCreatedResponse({ type: AdminRecipientCountResponseDto })
  async sendSystemNotification(@Body() dto: SendSystemNotificationDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    const ip = req.ip;
    return this.adminService.sendSystemNotification(dto, user.id, ip);
  }

  /** 预览接收者人数（不发通知） */
  @Post('notifications/system/preview')
  @ApiOperation({ summary: '预览系统通知接收者人数' })
  @ApiCreatedResponse({ type: AdminRecipientCountResponseDto })
  async previewRecipients(@Body() dto: SendSystemNotificationDto) {
    return this.adminService.previewRecipients(dto);
  }

  /** 系统通知发送历史 */
  @Get('notifications/system/history')
  @ApiOperation({ summary: '系统通知发送历史' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标' })
  @ApiOkResponse({ type: AdminSystemNotificationHistoryResponseDto })
  async getHistory(@Query('cursor') cursor?: string) {
    return this.adminService.getSystemNotificationHistory(cursor);
  }

  /** 用户搜索（管理员手动选择接收者） */
  @Get('users/search')
  @ApiOperation({ summary: '用户搜索（管理员用）' })
  @ApiQuery({ name: 'q', required: true, description: '用户名或邮箱关键词' })
  @ApiOkResponse({ type: AdminUserSearchResponseDto })
  async searchUsers(@Query('q') q: string) {
    return this.adminService.searchUsers(q);
  }
}
