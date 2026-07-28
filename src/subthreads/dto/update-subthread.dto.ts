import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, MaxLength, IsInt, Min } from 'class-validator';

/** 更新子贴 DTO */
export class UpdateSubthreadDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ description: '排序序号' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ enum: ['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'] })
  @IsOptional()
  @IsString()
  @IsIn(['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'])
  postingPolicy?: string;

  @ApiProperty({ description: '乐观锁版本号（必填，前端需先 fetch 获取当前 version）' })
  @IsInt()
  @Min(1)
  version: number;
}
