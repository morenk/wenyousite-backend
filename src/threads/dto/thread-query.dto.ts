import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/** 主题帖列表查询 DTO */
export class ThreadQueryDto extends CursorPaginationDto {
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
}
