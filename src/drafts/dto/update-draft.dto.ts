import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  IsInt,
  Min,
} from 'class-validator';

/** 更新草稿 DTO */
export class UpdateDraftDto {
  @ApiProperty({
    example: '更新后的草稿内容...',
    description: '更新后的草稿正文',
    maxLength: 10000,
  })
  @IsString()
  @MaxLength(10000)
  content: string;

  @ApiProperty({
    type: [String],
    example: ['1d20'],
    maxItems: 20,
    description: '待掷骰子表达式；省略按空数组处理',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  pendingDiceNotations?: string[];

  @ApiProperty({ example: 2, minimum: 1, description: '当前乐观锁版本' })
  @IsInt()
  @Min(1)
  version: number;
}
