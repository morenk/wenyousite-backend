import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { ReplyOrder } from '../../common/dto/reply-query.dto';

/** 帖子列表查询 DTO */
export class PostQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    enum: ReplyOrder,
    description: '主楼层顺序，默认 OLDEST',
  })
  @IsOptional()
  @IsEnum(ReplyOrder)
  order?: ReplyOrder;
}
