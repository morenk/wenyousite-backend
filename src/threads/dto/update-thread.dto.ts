import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, MinLength, MaxLength } from 'class-validator';

/** 更新主题帖 DTO：全部可选 */
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

  @ApiPropertyOptional({ example: 'PAUSED', enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'] })
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  status?: string;
}
