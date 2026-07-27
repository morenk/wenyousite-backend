import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsNumber, MinLength, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({ example: 'CLOSED', enum: ['RECRUITING', 'CLOSED', 'FINISHED'] })
  @IsOptional()
  @IsString()
  @IsIn(['RECRUITING', 'CLOSED', 'FINISHED'])
  status?: string;

  @ApiPropertyOptional({ description: '乐观锁版本号' })
  @IsOptional()
  @IsNumber()
  version?: number;
}
