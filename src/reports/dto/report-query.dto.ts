import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReportReasonCode, ReportStatus, ReportTargetType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class ReportQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;

  @ApiPropertyOptional({ enum: ReportReasonCode })
  @IsOptional()
  @IsEnum(ReportReasonCode)
  reasonCode?: ReportReasonCode;
}
