import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ModerationAppealStatus,
  ModerationCaseStatus,
  ModerationDecisionAction,
  ReportReasonCode,
  ReportTargetType,
} from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

export class ModerationCaseQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: ModerationCaseStatus })
  @IsOptional()
  @IsEnum(ModerationCaseStatus)
  status?: ModerationCaseStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;

  @ApiPropertyOptional({ enum: ReportReasonCode })
  @IsOptional()
  @IsEnum(ReportReasonCode)
  reasonCode?: ReportReasonCode;
}

export class ResolveModerationCaseDto {
  @ApiProperty({ enum: ['RESOLVED', 'DISMISSED'] })
  @IsIn(['RESOLVED', 'DISMISSED'])
  outcome!: 'RESOLVED' | 'DISMISSED';

  @ApiPropertyOptional({ enum: ModerationDecisionAction })
  @IsOptional()
  @IsEnum(ModerationDecisionAction)
  action?: ModerationDecisionAction;

  @ApiProperty({ enum: ReportReasonCode, description: '适用的站务规则分类' })
  @IsEnum(ReportReasonCode)
  policyCode!: ReportReasonCode;

  @ApiProperty({ minLength: 1, maxLength: 500, description: '向被处置用户公开' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  publicExplanation!: string;

  @ApiPropertyOptional({ maxLength: 1000, description: '仅管理员可见' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNote?: string;

  @ApiPropertyOptional({ format: 'date-time', description: '暂停账号时必填' })
  @IsOptional()
  @IsDateString()
  suspendUntil?: string;
}

export class CreateModerationAppealDto {
  @ApiProperty()
  @IsCuid()
  decisionId!: string;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  statement!: string;
}

export class IssueAppealTokenDto {
  @ApiProperty({ description: '邮箱或大小写敏感的用户名' })
  @IsString()
  @IsNotEmpty()
  account!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class ModerationAppealQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: ModerationAppealStatus })
  @IsOptional()
  @IsEnum(ModerationAppealStatus)
  status?: ModerationAppealStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;

  @ApiPropertyOptional({ enum: ModerationDecisionAction })
  @IsOptional()
  @IsEnum(ModerationDecisionAction)
  action?: ModerationDecisionAction;
}

export class ResolveModerationAppealDto {
  @ApiProperty({ enum: ['UPHELD', 'OVERTURNED'] })
  @IsIn(['UPHELD', 'OVERTURNED'])
  outcome!: 'UPHELD' | 'OVERTURNED';

  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}
