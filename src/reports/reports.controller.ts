import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { AdminAuth } from '../auth/decorators/admin-auth.decorator';
import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ApiCursorPaginatedResponse } from '../common/swagger/api-cursor-paginated-response.decorator';
import { AdminActor, AdminRole } from '../admin/admin-policy.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { AdminReportResponseDto, ReportResponseDto } from './dto/report-response.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ReportsService } from './reports.service';

function actorFrom(user: CurrentUserPayload): AdminActor {
  return {
    id: user.id,
    username: user.username,
    role: user.role as AdminRole,
  };
}

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Auth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '提交社区内容、用户或自己收到的私聊消息举报（Web/移动端兼容）' })
  @ApiCreatedResponse({ type: ReportResponseDto })
  @ApiConflictResponse({ description: '已存在相同待处理举报' })
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateReportDto) {
    return this.reports.create(user.id, dto);
  }
}

@ApiTags('Admin Reports')
@Controller('admin/reports')
@AdminAuth()
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({ summary: '管理员举报队列' })
  @ApiCursorPaginatedResponse(AdminReportResponseDto, '管理员举报队列')
  findAll(@Query() query: ReportQueryDto) {
    return this.reports.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '管理员举报详情' })
  @ApiOkResponse({ type: AdminReportResponseDto })
  findOne(@Param('id') id: string) {
    return this.reports.findOne(id);
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: '原子结案并可选执行治理动作' })
  @ApiOkResponse({ type: AdminReportResponseDto })
  @ApiConflictResponse({ description: '举报已结案或目标状态冲突' })
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: FastifyRequest,
  ) {
    return this.reports.resolve(id, actorFrom(user), dto, {
      ip: request.ip,
      requestId: request.id,
    });
  }
}
