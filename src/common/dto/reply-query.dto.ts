import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorPaginationDto } from './pagination.dto';

export enum ReplyOrder {
  OLDEST = 'OLDEST',
  NEWEST = 'NEWEST',
}

/** 回复串查询：排序方向与单一作者筛选都必须贯穿整个游标分页。 */
export class ReplyQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    enum: ReplyOrder,
    description:
      '列表顺序；帖子回复与动态独立楼中楼默认 OLDEST，动态主评论默认 NEWEST；动态主评论内嵌回复固定 OLDEST',
  })
  @IsOptional()
  @IsEnum(ReplyOrder)
  order?: ReplyOrder;

  @ApiPropertyOptional({ description: '只返回指定作者的回复' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  authorId?: string;
}
