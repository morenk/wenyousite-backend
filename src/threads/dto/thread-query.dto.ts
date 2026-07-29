import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

/** 主题帖列表查询 DTO */
export class ThreadQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: ['all', 'playing'], default: 'all', description: 'all=全部公开帖, playing=我参与的帖（playerMarked=true，需登录）' })
  @IsOptional()
  @IsString()
  @IsIn(['all', 'playing'])
  filter?: string = 'all';

  @ApiPropertyOptional({ enum: ['DEDUCTION', 'NATION', 'RPG'], description: '分区筛选' })
  @IsOptional()
  @IsString()
  @IsIn(['DEDUCTION', 'NATION', 'RPG'])
  category?: string;

  @ApiPropertyOptional({ enum: ['recommended', 'newest', 'active'], default: 'recommended', description: 'recommended=智能排序, newest=最新创建, active=最新回复' })
  @IsOptional()
  @IsString()
  @IsIn(['recommended', 'newest', 'active'])
  sort?: string = 'recommended';

  @ApiPropertyOptional({ description: '标签筛选' })
  @IsOptional()
  @IsString()
  tag?: string;
}
