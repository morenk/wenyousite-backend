import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';
import { ReplyOrder } from '../../common/dto/reply-query.dto';

const AUTHOR_USER_ID_PATTERN =
  '^(?:[a-z0-9]{24,26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$';
const AUTHOR_USER_ID_REGEX = new RegExp(AUTHOR_USER_ID_PATTERN);

/** 帖子列表查询 DTO */
export class PostQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({
    enum: ReplyOrder,
    description: '主楼层顺序，默认 OLDEST',
  })
  @IsOptional()
  @IsEnum(ReplyOrder)
  order?: ReplyOrder;

  @ApiPropertyOptional({
    pattern: AUTHOR_USER_ID_PATTERN,
    description: '只返回指定楼主、协作者或玩家创建的主楼层；接受现有 CUID 与 UUID 用户 ID',
  })
  @IsOptional()
  @Matches(AUTHOR_USER_ID_REGEX)
  authorId?: string;
}
