import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportReasonCode, ReportStatus, ReportTargetType, UserRole } from '@prisma/client';

export class ReportUserSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;
}

export class ReportResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  reporterId!: string | null;

  @ApiProperty({ enum: ReportTargetType })
  targetType!: ReportTargetType;

  @ApiProperty()
  targetId!: string;

  @ApiProperty({ enum: ReportReasonCode })
  reasonCode!: ReportReasonCode;

  @ApiProperty({ type: String, nullable: true })
  details!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  targetSnapshot!: Record<string, unknown> | null;

  @ApiProperty({ enum: ReportStatus })
  status!: ReportStatus;

  @ApiProperty({ type: String, nullable: true })
  handledBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  handledAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  resolutionNote!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class AdminReportResponseDto extends ReportResponseDto {
  @ApiProperty({ type: ReportUserSummaryDto, nullable: true })
  reporter!: ReportUserSummaryDto | null;

  @ApiProperty({ type: ReportUserSummaryDto, nullable: true })
  handler!: ReportUserSummaryDto | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  targetState?: Record<string, unknown> | null;
}
