import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, Matches } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';
import { CATEGORY_SLUG_PATTERN } from '../../taxonomy/category-slug';

/** 主题帖列表查询 DTO */
export class ThreadQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    enum: ['all', 'playing'],
    default: 'all',
    description: 'all=全部公开帖, playing=我参与的帖（playerMarked=true，需登录）',
  })
  @IsOptional()
  @IsString()
  @IsIn(['all', 'playing'])
  filter?: string = 'all';

  @ApiPropertyOptional({ example: 'DEDUCTION', description: '按动态分类 slug 筛选' })
  @IsOptional()
  @IsString()
  @Matches(CATEGORY_SLUG_PATTERN)
  category?: string;

  @ApiPropertyOptional({
    enum: ['recommended', 'newest', 'active'],
    default: 'recommended',
    description: 'recommended=智能排序, newest=最新创建, active=最新回复',
  })
  @IsOptional()
  @IsString()
  @IsIn(['recommended', 'newest', 'active'])
  sort?: string = 'recommended';

  @ApiPropertyOptional({
    enum: ['RECRUITING', 'CLOSED', 'FINISHED'],
    description: '主题帖状态筛选：招募中、已停招、已结束',
  })
  @IsOptional()
  @IsString()
  @IsIn(['RECRUITING', 'CLOSED', 'FINISHED'])
  status?: string;

  @ApiPropertyOptional({ example: '无限流', description: '按标签名模糊筛选主题帖' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    example: 'cms7rnyij000z7qdyg6zbge8e',
    description: '按主题帖标签 ID 精确筛选；与 tag 同时传入时优先使用 tagId',
  })
  @IsOptional()
  @IsCuid()
  tagId?: string;
}
