import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MinLength, MaxLength, IsIn, IsNumber } from 'class-validator';

/** 创建子贴 DTO */
export class CreateSubthreadDto {
  @ApiProperty({ example: '设定区', description: '子贴标题', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiProperty({ example: '这里是世界观设定...', description: '第一楼正文（子贴正文）', minLength: 1, maxLength: 10000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @ApiPropertyOptional({ example: 1, description: '排序序号，越小越靠前' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({ enum: ['PUBLIC', 'MEMBERS'], default: 'PUBLIC', description: '可见性' })
  @IsOptional()
  @IsString()
  @IsIn(['PUBLIC', 'MEMBERS'])
  visibility?: string;

  @ApiPropertyOptional({ enum: ['COLLABORATORS', 'PARTICIPANTS'], default: 'PARTICIPANTS', description: '发帖权限（PARTICIPANTS=所有成员, COLLABORATORS=仅协作者）' })
  @IsOptional()
  @IsString()
  @IsIn(['COLLABORATORS', 'PARTICIPANTS'])
  postingPolicy?: string;
}
