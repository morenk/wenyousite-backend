import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsOptional,
  IsInt,
  MaxLength,
  Min,
} from 'class-validator';

/** 编辑帖子 DTO */
export class UpdatePostDto {
  @ApiProperty({
    example: '编辑后的内容...',
    description: '新正文；已有或本次新增骰子结果时允许为空',
    maxLength: 10000,
  })
  @IsString()
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['1d20'],
    maxItems: 20,
    description: '已发布帖子中追加新骰子；未发布帖子中替换待掷列表，省略则保留',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  diceNotations?: string[];

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: '乐观锁版本号（必填，前端需先 fetch 获取当前 version，传入过期版本会返回 409）',
  })
  @IsInt()
  @Min(1)
  version: number;
}
