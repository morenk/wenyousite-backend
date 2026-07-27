import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, MaxLength, IsNumber } from 'class-validator';

/** 更新子贴 DTO */
export class UpdateSubthreadDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ description: '排序序号' })
  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @ApiPropertyOptional({ enum: ['COLLABORATORS', 'PARTICIPANTS'] })
  @IsOptional()
  @IsString()
  @IsIn(['COLLABORATORS', 'PARTICIPANTS'])
  postingPolicy?: string;

  @ApiPropertyOptional({ description: '乐观锁版本号' })
  @IsOptional()
  @IsNumber()
  version?: number;
}
