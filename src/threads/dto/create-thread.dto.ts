import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsIn, IsArray, IsNumber } from 'class-validator';

/** 创建主题帖 DTO */
export class CreateThreadDto {
  @ApiProperty({ example: '奇幻大陆', description: '主题帖标题', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiProperty({ example: '这是一个关于奇幻大陆的故事...', description: '第一楼正文（任意富文本）' })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiProperty({ example: 'DEDUCTION', enum: ['DEDUCTION', 'NATION', 'RPG'], description: '分区' })
  @IsString()
  @IsIn(['DEDUCTION', 'NATION', 'RPG'])
  category: string;

  @ApiPropertyOptional({ example: ['无限流', '穿越'], description: '主题帖标签名称列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagNames?: string[];
}
