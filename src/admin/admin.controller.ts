import { Controller, Get, Post, Body, Req, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { SendSystemNotificationDto } from './dto/send-system-notification.dto';

/** 管理后台控制器：系统通知发送、预览、历史、用户搜索 */
@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  /** 管理后台根路径，返回服务状态 */
  @Get()
  @ApiOperation({ summary: '管理后台入口' })
  index() {
    return { name: '温油站管理后台', status: 'running', docs: '/api/docs' };
  }

  /** 发送系统通知（管理员） */
  @Post('notifications/system')
  @UseGuards(JwtAuthGuard, VerifiedGuard, AdminGuard)
  @ApiOperation({ summary: '发送系统通知（管理员，手动指定 / 条件筛选 / 全站广播）' })
  async sendSystemNotification(@Body() dto: SendSystemNotificationDto, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    const ip = req.ip;
    return this.adminService.sendSystemNotification(dto, user.id, ip);
  }

  /** 预览接收者人数（不发通知） */
  @Post('notifications/system/preview')
  @UseGuards(JwtAuthGuard, VerifiedGuard, AdminGuard)
  @ApiOperation({ summary: '预览系统通知接收者人数' })
  async previewRecipients(@Body() dto: SendSystemNotificationDto) {
    return this.adminService.previewRecipients(dto);
  }

  /** 系统通知发送历史 */
  @Get('notifications/system/history')
  @UseGuards(JwtAuthGuard, VerifiedGuard, AdminGuard)
  @ApiOperation({ summary: '系统通知发送历史' })
  @ApiQuery({ name: 'cursor', required: false, description: '分页游标' })
  async getHistory(@Query('cursor') cursor?: string) {
    return this.adminService.getSystemNotificationHistory(cursor);
  }

  /** 用户搜索（管理员手动选择接收者） */
  @Get('users/search')
  @UseGuards(JwtAuthGuard, VerifiedGuard, AdminGuard)
  @ApiOperation({ summary: '用户搜索（管理员用）' })
  @ApiQuery({ name: 'q', required: true, description: '用户名或邮箱关键词' })
  async searchUsers(@Query('q') q: string) {
    return this.adminService.searchUsers(q);
  }
}
