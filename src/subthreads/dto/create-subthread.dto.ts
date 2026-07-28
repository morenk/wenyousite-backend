import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsIn, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeContent } from '../../common/transform/sanitize.transform';

/** 创建子贴 DTO */
export class CreateSubthreadDto {
  @ApiProperty({ example: '设定区', description: '子贴标题', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({ example: '这里是世界观设定...', description: '第一楼正文（可选，留空仅创建空子贴）', maxLength: 10000 })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => sanitizeContent(value))
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({ example: 1, description: '排序序号，越小越靠前' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({ enum: ['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'], default: 'PARTICIPANTS', description: 'PARTICIPANTS=所有成员, COLLABORATORS=仅协作者, PLAYERS=仅玩家' })
  @IsOptional()
  @IsString()
  @IsIn(['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'])
  postingPolicy?: string;
}
