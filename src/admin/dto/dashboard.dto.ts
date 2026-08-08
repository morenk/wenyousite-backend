import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class AdminDashboardRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01', description: '北京时间起始日期（含）' })
  @IsOptional()
  @Matches(DATE_KEY_PATTERN)
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-08', description: '北京时间结束日期（含）' })
  @IsOptional()
  @Matches(DATE_KEY_PATTERN)
  to?: string;
}
