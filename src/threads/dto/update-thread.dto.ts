import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, IsBoolean, MinLength, MaxLength, Min } from 'class-validator';

/** 更新主题帖 DTO：全部可选。published 设为 true 即发布草稿 */
export class UpdateThreadDto {
  @ApiPropertyOptional({ example: '奇幻大陆·重置版', minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ example: 'DEDUCTION', enum: ['DEDUCTION', 'NATION', 'RPG'] })
  @IsOptional()
  @IsString()
  @IsIn(['DEDUCTION', 'NATION', 'RPG'])
  category?: string;

  @ApiPropertyOptional({ example: 'CLOSED', enum: ['RECRUITING', 'CLOSED', 'FINISHED'] })
  @IsOptional()
  @IsString()
  @IsIn(['RECRUITING', 'CLOSED', 'FINISHED'])
  status?: string;

  @ApiPropertyOptional({ example: 'PUBLIC', enum: ['PUBLIC', 'PRIVATE'], description: '可见性（PUBLIC=公开, PRIVATE=仅成员）' })
  @IsOptional()
  @IsString()
  @IsIn(['PUBLIC', 'PRIVATE'])
  visibility?: string;

  @ApiPropertyOptional({ example: true, description: '设为 true 发布草稿。发布时校验 title/category 是否填写、是否至少有一个子贴含楼层。发布后通知粉丝' })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiProperty({ example: 1, minimum: 1, description: '乐观锁版本号（必填，前端先 fetch 获取当前 version，过期返回 409）' })
  @IsInt()
  @Min(1)
  version: number;
}
