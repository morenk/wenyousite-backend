import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuth } from './admin-auth.decorator';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDashboardRangeQueryDto } from './dto/dashboard.dto';
import {
  AdminDashboardDistributionsResponseDto,
  AdminDashboardOverviewResponseDto,
  AdminDashboardTimeseriesResponseDto,
} from './dto/dashboard-response.dto';

@ApiTags('Admin Dashboard')
@Controller('admin/dashboard')
@AdminAuth()
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: '管理看板概览、环比区间和 DAU/WAU/MAU' })
  @ApiOkResponse({ type: AdminDashboardOverviewResponseDto })
  overview(@Query() query: AdminDashboardRangeQueryDto) {
    return this.dashboard.overview(query);
  }

  @Get('timeseries')
  @ApiOperation({ summary: '管理看板按日时间序列' })
  @ApiOkResponse({ type: AdminDashboardTimeseriesResponseDto })
  timeseries(@Query() query: AdminDashboardRangeQueryDto) {
    return this.dashboard.timeseries(query);
  }

  @Get('distributions')
  @ApiOperation({ summary: '用户、举报、内容和处罚分布' })
  @ApiOkResponse({ type: AdminDashboardDistributionsResponseDto })
  distributions() {
    return this.dashboard.distributions();
  }
}
