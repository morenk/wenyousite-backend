import {
  Controller, Get, Post, Delete, Body, Param, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: '我的订阅列表' })
  async findAll(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.subscriptionsService.findAll(user.id);
  }

  @Post()
  @ApiOperation({ summary: '创建订阅（type=THREAD 整帖 / type=USER 某个用户）' })
  async create(
    @Body() dto: { threadId: string; type: 'THREAD' | 'USER'; targetUserId?: string },
    @Req() req: FastifyRequest,
  ) {
    const user = req['user'] as { id: string };
    return this.subscriptionsService.create(user.id, dto.threadId, dto.type, dto.targetUserId);
  }

  @Delete(':id')
  @ApiOperation({ summary: '取消订阅' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.subscriptionsService.remove(id, user.id);
    return { message: '已取消订阅' };
  }
}
