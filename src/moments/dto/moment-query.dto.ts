import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export enum MomentFeedMode {
  DISCOVER = 'DISCOVER',
  FOLLOWING = 'FOLLOWING',
}

export class MomentFeedQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: MomentFeedMode, default: MomentFeedMode.DISCOVER })
  @IsOptional()
  @IsEnum(MomentFeedMode)
  feed: MomentFeedMode = MomentFeedMode.DISCOVER;
}
