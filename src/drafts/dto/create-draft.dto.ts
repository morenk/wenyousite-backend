import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsIn } from 'class-validator';

/** 保存草稿 DTO */
export class CreateDraftDto {
  @ApiProperty({ description: '草稿内容', maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiProperty({ description: '所属子贴 ID' })
  @IsString()
  subthreadId: string;

  @ApiPropertyOptional({ example: 1, description: '草稿位（1-5），不传则自动选择空闲位' })
  @IsOptional()
  @IsIn([1, 2, 3, 4, 5])
  slot?: number;
}
