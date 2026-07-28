import { Controller, Get, Post, Patch, Delete, Param, Query, Req, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { NotificationsService } from './notifications.service';
import { AuthRead } from '../auth/decorators/auth.decorator';

/** 通知控制器：站内通知的查询、标记已读/未读、删除 */
@ApiTags('Notifications')
@Controller('notifications')
@AuthRead()
@ApiBearerAuth()
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  /** 通知列表（cursor 分页，支持按类型过滤） */
  @Get()
  @ApiOperation({ summary: '通知列表' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'type', required: false, description: '按类型过滤，逗号分隔，如 type=mention,reply' })
  async findAll(@Req() req: FastifyRequest, @Query('cursor') cursor?: string, @Query('type') type?: string) {
    const user = req['user'] as { id: string };
    const types = type ? type.split(',').map(t => t.trim()).filter(Boolean) : undefined;
    return this.notificationsService.findAll(user.id, cursor, 20, types);
  }

  /** 未读通知数量 */
  @Get('unread')
  @ApiOperation({ summary: '未读通知数' })
  async unreadCount(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    const count = await this.notificationsService.unreadCount(user.id);
    return { unreadCount: count };
  }

  /** 标记单条通知阅读状态（支持标记未读） */
  @Patch(':id')
  @ApiOperation({ summary: '标记通知阅读状态' })
  async setReadStatus(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Body() body: { isRead: boolean },
  ) {
    const user = req['user'] as { id: string };
    await this.notificationsService.setReadStatus(id, user.id, body.isRead);
    return { message: body.isRead ? '已标记为已读' : '已标记为未读' };
  }

  /** 一键全部标记已读 */
  @Post('read-all')
  @ApiOperation({ summary: '全部已读' })
  async markAllAsRead(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.notificationsService.markAllAsRead(user.id);
    return { message: '全部已标记为已读' };
  }

  /** 硬删除单条通知 */
  @Delete(':id')
  @ApiOperation({ summary: '删除通知' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.notificationsService.remove(id, user.id);
    return { message: '已删除' };
  }
}
