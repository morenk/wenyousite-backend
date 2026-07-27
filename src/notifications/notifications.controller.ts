import { Controller, Get, Post, Patch, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { NotificationsService } from './notifications.service';
import { AuthRead } from '../auth/decorators/auth.decorator';

/** 通知控制器：站内通知的查询、标记已读 */
@ApiTags('Notifications')
@Controller('notifications')
@AuthRead()
@ApiBearerAuth()
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  /** 通知列表（cursor 分页，含关联帖子/主题/发信人信息） */
  @Get()
  @ApiOperation({ summary: '通知列表' })
  @ApiQuery({ name: 'cursor', required: false })
  async findAll(@Req() req: FastifyRequest, @Query('cursor') cursor?: string) {
    const user = req['user'] as { id: string };
    return this.notificationsService.findAll(user.id, cursor);
  }

  /** 未读通知数量 */
  @Get('unread')
  @ApiOperation({ summary: '未读通知数' })
  async unreadCount(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    const count = await this.notificationsService.unreadCount(user.id);
    return { unreadCount: count };
  }

  /** 标记单条通知为已读 */
  @Patch(':id/read')
  @ApiOperation({ summary: '标记单条已读' })
  async markAsRead(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.notificationsService.markAsRead(id, user.id);
    return { message: '已标记为已读' };
  }

  /** 一键全部标记已读 */
  @Post('read-all')
  @ApiOperation({ summary: '全部已读' })
  async markAllAsRead(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.notificationsService.markAllAsRead(user.id);
    return { message: '全部已标记为已读' };
  }
}
