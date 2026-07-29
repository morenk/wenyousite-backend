import { Controller, Get, Post, Delete, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiOkResponse, ApiCreatedResponse, ApiUnauthorizedResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';

/** 订阅控制器：玩家订阅主题帖或特定用户回复 */
@ApiTags('Subscriptions')
@Controller('subscriptions')
@ApiBearerAuth()
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  /** 我的订阅列表 */
  @Get()
  @AuthRead()
  @ApiOperation({ summary: '我的订阅列表' })
  @ApiOkResponse({ description: '我的订阅列表（含订阅类型和关联信息）' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async findAll(@Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    return this.subscriptionsService.findAll(user.id);
  }

  /** 创建订阅（type=THREAD 整帖 / type=USER 某个用户在该主题帖下的回复） */
  @Post()
  @Auth()
  @ApiOperation({ summary: '创建订阅' })
  @ApiCreatedResponse({ description: '创建的订阅记录' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  async create(@Req() req: FastifyRequest, @Body() dto: CreateSubscriptionDto) {
    const user = req['user'] as { id: string };
    return this.subscriptionsService.create(user.id, dto.threadId, dto.type, dto.targetUserId);
  }

  /** 取消订阅 */
  @Delete(':id')
  @Auth()
  @ApiOperation({ summary: '取消订阅' })
  @ApiOkResponse({ description: '已取消订阅' })
  @ApiUnauthorizedResponse({ description: '未登录或 Token 无效' })
  @ApiNotFoundResponse({ description: '订阅不存在' })
  async remove(@Param('id') id: string, @Req() req: FastifyRequest) {
    const user = req['user'] as { id: string };
    await this.subscriptionsService.remove(id, user.id);
    return { message: '已取消订阅' };
  }
}
