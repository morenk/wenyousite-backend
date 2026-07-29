import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VerifiedGuard } from '../common/guards/verified.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { SendSystemNotificationDto } from './dto/send-system-notification.dto';

/** 管理后台控制器：系统通知发送 */
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
  @ApiOperation({ summary: '发送系统通知（管理员，指定用户或全站广播）' })
  async sendSystemNotification(@Body() dto: SendSystemNotificationDto) {
    return this.adminService.sendSystemNotification(dto);
  }
}
