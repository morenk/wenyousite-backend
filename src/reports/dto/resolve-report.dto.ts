import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const REPORT_RESOLUTION_ACTIONS = [
  'NONE',
  'HIDE_CONTENT',
  'SUSPEND_USER',
  'BAN_USER',
] as const;
export type ReportResolutionAction = (typeof REPORT_RESOLUTION_ACTIONS)[number];

export class ResolveReportDto {
  @ApiProperty({ enum: ['RESOLVED', 'DISMISSED'] })
  @IsIn(['RESOLVED', 'DISMISSED'])
  outcome!: 'RESOLVED' | 'DISMISSED';

  @ApiProperty({ minLength: 1, maxLength: 1000, description: '同时作为关联处罚的理由' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;

  @ApiPropertyOptional({ enum: REPORT_RESOLUTION_ACTIONS, default: 'NONE' })
  @IsOptional()
  @IsIn(REPORT_RESOLUTION_ACTIONS)
  action?: ReportResolutionAction = 'NONE';

  @ApiPropertyOptional({ format: 'date-time', description: 'SUSPEND_USER 时必填' })
  @IsOptional()
  @IsDateString()
  suspendUntil?: string;
}
