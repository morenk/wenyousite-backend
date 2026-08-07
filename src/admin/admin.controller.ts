import { Controller, Get, Post, Body, Req, UseGuards, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiExtension, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { SendSystemNotificationDto } from './dto/send-system-notification.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  AdminRecipientCountResponseDto,
  AdminStatusResponseDto,
  AdminSystemNotificationHistoryResponseDto,
  AdminUserSearchResponseDto,
} from './dto/admin-response.dto';

/** 管理后台控制器：系统通知发送、预览、历史、用户搜索 */
@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  /** 管理后台根路径，返回服务状态 */
  @Get()
  @Public()
  @ApiOperation({ summary: '管理后台入口' })
  @ApiOkResponse({ type: AdminStatusResponseDto })
  index() {
    return { name: '温油站管理后台', status: 'running', docs: '/api/docs' };
  }

  /** 发送系统通知（管理员） */
  @Post('notifications/system')
  @Auth()
  @UseGuards(AdminGuard)
  @ApiExtension('x-auth-mode', 'admin')
  @ApiOperation({ summary: '发送系统通知（管理员，手动指定 / 条件筛选 / 全站广播）' })
  @ApiCreatedResponse({ type: AdminRecipientCountResponseDto })
  async sendSystemNotification(@Body() dto: SendSystemNotificationDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    const ip = req.ip;
    return this.adminService.sendSystemNotification(dto, user.id, ip);
  }

  /** 预览接收者人数（不发通知） */
  @Post('notifications/system/preview')
  @Auth()
  @UseGuards(AdminGuard)
  @ApiExtension('x-auth-mode', 'admin')
  @ApiOperation({ summary: '预览系统通知接收者人数' })
  @ApiCreatedResponse({ type: AdminRecipientCountResponseDto })
  async previewRecipients(@Body() dto: SendSystemNotificationDto) {
    return this.adminService.previewRecipients(dto);
  }

  /** 系统通知发送历史 */
  @Get('notifications/system/history')
  @Auth()
  @UseGuards(AdminGuard)
  @ApiExtension('x-auth-mode', 'admin')
  @ApiOperation({ summary: '系统通知发送历史' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标' })
  @ApiOkResponse({ type: AdminSystemNotificationHistoryResponseDto })
  async getHistory(@Query('cursor') cursor?: string) {
    return this.adminService.getSystemNotificationHistory(cursor);
  }

  /** 用户搜索（管理员手动选择接收者） */
  @Get('users/search')
  @Auth()
  @UseGuards(AdminGuard)
  @ApiExtension('x-auth-mode', 'admin')
  @ApiOperation({ summary: '用户搜索（管理员用）' })
  @ApiQuery({ name: 'q', required: true, description: '用户名或邮箱关键词' })
  @ApiOkResponse({ type: AdminUserSearchResponseDto })
  async searchUsers(@Query('q') q: string) {
    return this.adminService.searchUsers(q);
  }
}
