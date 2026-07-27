import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ReportsService } from './reports.service';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Post()
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '提交举报' })
  async create(
    @Req() req: FastifyRequest,
    @Body() dto: { targetType: string; targetId: string; reason: string },
  ) {
    const user = req['user'] as { id: string };
    return this.reportsService.create(user.id, dto.targetType, dto.targetId, dto.reason);
  }

  @Get()
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '举报列表（管理员）' })
  async findAll(@Req() req: FastifyRequest, @Query('status') status?: string) {
    const user = req['user'] as { role: string };
    if (user.role !== 'ADMIN') return { message: '无权限' };
    return this.reportsService.findAll(status);
  }

  @Patch(':id/handle')
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '处理举报（管理员）' })
  async handle(
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    const user = req['user'] as { id: string; role: string };
    if (user.role !== 'ADMIN') return { message: '无权限' };
    return this.reportsService.handle(id, user.id, status);
  }
}
