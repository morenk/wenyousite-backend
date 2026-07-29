import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsIn, IsArray } from 'class-validator';

/** 创建主题帖草稿 DTO：全部可选，发布时校验完整 */
export class CreateThreadDto {
  @ApiPropertyOptional({ example: '我的第一个主题帖', description: '主题帖标题（可为空，发布时校验）', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ enum: ['DEDUCTION', 'NATION', 'RPG'], default: 'DEDUCTION', description: '分区' })
  @IsOptional()
  @IsString()
  @IsIn(['DEDUCTION', 'NATION', 'RPG'])
  category?: string;

  @ApiPropertyOptional({ example: ['无限流', '穿越'], description: '主题帖标签名称列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagNames?: string[];

  @ApiPropertyOptional({ enum: ['PUBLIC', 'PRIVATE'], default: 'PUBLIC', description: '可见性' })
  @IsOptional()
  @IsString()
  @IsIn(['PUBLIC', 'PRIVATE'])
  visibility?: string;
}
