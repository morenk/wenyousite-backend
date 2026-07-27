import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';

/** 主题帖列表查询 DTO */
export class ThreadQueryDto {
  @ApiPropertyOptional({ enum: ['DEDUCTION', 'NATION', 'RPG'], description: '分区筛选' })
  @IsOptional()
  @IsString()
  @IsIn(['DEDUCTION', 'NATION', 'RPG'])
  category?: string;

  @ApiPropertyOptional({ enum: ['recommended', 'newest', 'active'], default: 'recommended', description: '排序方式' })
  @IsOptional()
  @IsString()
  @IsIn(['recommended', 'newest', 'active'])
  sort?: string = 'recommended';

  @ApiPropertyOptional({ description: '标签筛选' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ description: '游标分页 cursor' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: '每页条数', default: 20 })
  @IsOptional()
  limit?: number = 20;
}
