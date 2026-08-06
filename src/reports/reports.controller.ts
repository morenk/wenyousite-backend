import { Controller, Get, Post, Patch, Body, Param, Query, Req, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { HandleReportDto } from './dto/handle-report.dto';
import { Auth, AuthRead } from '../auth/decorators/auth.decorator';

/** 举报控制器：举报提交与管理员处理 */
@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  /** 用户提交举报 */
  @Post()
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '提交举报' })
  async create(@Req() req: FastifyRequest, @Body() dto: CreateReportDto) {
    const user = req['user'] as { id: string };
    return this.reportsService.create(user.id, dto.targetType, dto.targetId, dto.reason);
  }

  /** 管理员查看举报列表 */
  @Get()
  @AuthRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: '举报列表（管理员）' })
  async findAll(@Req() req: FastifyRequest, @Query('status') status?: string) {
    const user = req['user'] as { role: string };
    if (user.role !== 'ADMIN') throw new ForbiddenException('无权限');
    return this.reportsService.findAll(status);
  }

  /** 管理员处理举报（标记已处理/驳回） */
  @Patch(':id/handle')
  @Auth()
  @ApiBearerAuth()
  @ApiOperation({ summary: '处理举报（管理员）' })
  async handle(@Req() req: FastifyRequest, @Param('id') id: string, @Body() dto: HandleReportDto) {
    const user = req['user'] as { id: string; role: string };
    if (user.role !== 'ADMIN') throw new ForbiddenException('无权限');
    return this.reportsService.handle(id, user.id, dto.status);
  }
}
