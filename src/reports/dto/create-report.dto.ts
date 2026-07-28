import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, IsUUID } from 'class-validator';

/** 提交举报 DTO */
export class CreateReportDto {
  @ApiProperty({ description: '举报目标类型' })
  @IsString()
  @MinLength(1)
  targetType: string;

  @ApiProperty({ description: '举报目标 ID' })
  @IsString()
  @IsUUID()
  targetId: string;

  @ApiProperty({ description: '举报原因' })
  @IsString()
  @MinLength(1)
  reason: string;
}
