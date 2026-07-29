import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, MaxLength, IsInt, Min } from 'class-validator';

/** 更新子贴 DTO */
export class UpdateSubthreadDto {
  @ApiPropertyOptional({ example: '新标题', description: '子贴标题', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ example: 2, description: '排序序号（仅非默认子贴可修改）' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ enum: ['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'], description: 'PARTICIPANTS=所有参与人可发帖, COLLABORATORS=仅协作者可发帖, PLAYERS=仅玩家可发帖' })
  @IsOptional()
  @IsString()
  @IsIn(['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'])
  postingPolicy?: string;

  @ApiProperty({ example: 1, minimum: 1, description: '乐观锁版本号（必填，过期返回 409）' })
  @IsInt()
  @Min(1)
  version: number;
}
