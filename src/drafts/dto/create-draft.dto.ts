import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsOptional,
  MaxLength,
  IsIn,
  IsInt,
  Min,
} from 'class-validator';

/** 保存草稿 DTO */
export class CreateDraftDto {
  @ApiProperty({
    example: '这是一段草稿内容...',
    description: '草稿正文；允许为空，但必须至少包含一个待掷骰子',
    maxLength: 10000,
  })
  @IsString()
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['1d20'],
    maxItems: 20,
    description: '待掷骰子表达式，与正文作为同一版本快照保存',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  pendingDiceNotations?: string[];

  @ApiPropertyOptional({ example: 1, description: '草稿位（1-5），不传则自动选择空闲位' })
  @IsOptional()
  @IsIn([1, 2, 3, 4, 5])
  slot?: number;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description: '覆盖已有槽位时必填的当前乐观锁版本；创建空槽位时省略',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
