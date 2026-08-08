import { ApiProperty } from '@nestjs/swagger';

export class AdminDashboardRangeResponseDto {
  @ApiProperty({ example: '2026-08-01' })
  from!: string;

  @ApiProperty({ example: '2026-08-08' })
  to!: string;

  @ApiProperty({ example: '2026-07-24' })
  previousFrom!: string;

  @ApiProperty({ example: '2026-07-31' })
  previousTo!: string;

  @ApiProperty({ example: 'Asia/Shanghai' })
  timezone!: string;
}

export class AdminDashboardPeriodMetricsDto {
  @ApiProperty({ example: 128, description: '区间内至少活跃一天的去重普通用户数' })
  activeUsers!: number;

  @ApiProperty({ example: 17 })
  newUsers!: number;

  @ApiProperty({ example: 12 })
  publishedThreads!: number;

  @ApiProperty({ example: 86, description: '新增楼层数，不包含主题正文 BODY' })
  newPosts!: number;

  @ApiProperty({ example: 9 })
  reportsReceived!: number;

  @ApiProperty({ example: 7 })
  reportsHandled!: number;
}

export class AdminDashboardActivityMetricsDto {
  @ApiProperty({ example: 42 })
  dau!: number;

  @ApiProperty({ example: 173 })
  wau!: number;

  @ApiProperty({ example: 486 })
  mau!: number;
}

export class AdminDashboardSnapshotDto {
  @ApiProperty({ example: 1024 })
  totalUsers!: number;

  @ApiProperty({ example: 4 })
  pendingReports!: number;

  @ApiProperty({ example: 3 })
  activeSuspensions!: number;

  @ApiProperty({ example: 2 })
  activeBans!: number;
}

export class AdminDashboardOverviewResponseDto {
  @ApiProperty({ type: AdminDashboardRangeResponseDto })
  range!: AdminDashboardRangeResponseDto;

  @ApiProperty({ type: AdminDashboardActivityMetricsDto })
  activity!: AdminDashboardActivityMetricsDto;

  @ApiProperty({ type: AdminDashboardPeriodMetricsDto })
  current!: AdminDashboardPeriodMetricsDto;

  @ApiProperty({ type: AdminDashboardPeriodMetricsDto })
  previous!: AdminDashboardPeriodMetricsDto;

  @ApiProperty({ type: AdminDashboardSnapshotDto })
  snapshot!: AdminDashboardSnapshotDto;
}

export class AdminDashboardTimeseriesPointDto {
  @ApiProperty({ example: '2026-08-08' })
  date!: string;

  @ApiProperty({ example: 42 })
  dau!: number;

  @ApiProperty({ example: 5 })
  newUsers!: number;

  @ApiProperty({ example: 3 })
  publishedThreads!: number;

  @ApiProperty({ example: 18 })
  newPosts!: number;

  @ApiProperty({ example: 2 })
  reportsReceived!: number;

  @ApiProperty({ example: 1 })
  reportsHandled!: number;
}

export class AdminDashboardTimeseriesResponseDto {
  @ApiProperty({ type: AdminDashboardRangeResponseDto })
  range!: AdminDashboardRangeResponseDto;

  @ApiProperty({ type: AdminDashboardTimeseriesPointDto, isArray: true })
  items!: AdminDashboardTimeseriesPointDto[];
}

export class AdminDashboardDistributionItemDto {
  @ApiProperty({ example: 'USER' })
  key!: string;

  @ApiProperty({ example: 42 })
  count!: number;
}

export class AdminDashboardDistributionsResponseDto {
  @ApiProperty({ type: AdminDashboardDistributionItemDto, isArray: true })
  usersByRole!: AdminDashboardDistributionItemDto[];

  @ApiProperty({ type: AdminDashboardDistributionItemDto, isArray: true })
  reportsByStatus!: AdminDashboardDistributionItemDto[];

  @ApiProperty({ type: AdminDashboardDistributionItemDto, isArray: true })
  reportsByReason!: AdminDashboardDistributionItemDto[];

  @ApiProperty({ type: AdminDashboardDistributionItemDto, isArray: true })
  threadsByCategory!: AdminDashboardDistributionItemDto[];

  @ApiProperty({ type: AdminDashboardDistributionItemDto, isArray: true })
  activeSanctionsByType!: AdminDashboardDistributionItemDto[];
}
