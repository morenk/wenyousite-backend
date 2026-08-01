import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

/** 提交举报 DTO */
export class CreateReportDto {
  @ApiProperty({ description: '举报目标类型' })
  @IsString()
  @MinLength(1)
  targetType: string;

  @ApiProperty({ description: '举报目标 ID' })
  @IsString()
  @IsCuid()
  targetId: string;

  @ApiProperty({ description: '举报原因' })
  @IsString()
  @MinLength(1)
  reason: string;
}
