import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportReasonCode, ReportTargetType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 新举报只接受类型化的公开社区目标。 */
export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType })
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @ApiProperty()
  @IsCuid()
  targetId!: string;

  @ApiProperty({ enum: ReportReasonCode })
  @IsEnum(ReportReasonCode)
  reasonCode!: ReportReasonCode;

  @ApiPropertyOptional({ maxLength: 1000, description: '选择 OTHER 时必填' })
  @ValidateIf(
    (dto: CreateReportDto) =>
      dto.reasonCode === ReportReasonCode.OTHER || dto.details !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  @IsOptional({ groups: ['non-other'] })
  details?: string;
}
