import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ReplyQueryDto } from '../../common/dto/reply-query.dto';
import { FloorResponseDto, ReplyResponseDto } from './post-response.dto';

export class DiscussionWindowQueryDto extends ReplyQueryDto {
  @ApiPropertyOptional({ minimum: 1, description: '固定楼层/回复编号；与 postId、cursor 互斥' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  number?: number;

  @ApiPropertyOptional({ description: '已有帖子深链 ID；与 number、cursor 互斥' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  postId?: string;
}
export class DiscussionWindowTargetDto {
  @ApiProperty()
  id!: string;
  @ApiProperty({ minimum: 1 })
  number!: number;
}
export class DiscussionWindowBaseDto {
  @ApiProperty({ minimum: 0, description: '当前查看者、作者筛选下的可见条数' })
  total!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: '当前查看者在本范围可访问的最大固定编号，不受作者筛选影响；无可访问内容为 null',
  })
  maxNumber!: number | null;
  @ApiProperty({ type: DiscussionWindowTargetDto, nullable: true })
  target!: DiscussionWindowTargetDto | null;
  @ApiProperty({ type: String, nullable: true })
  beforeCursor!: string | null;
  @ApiProperty({ type: String, nullable: true })
  afterCursor!: string | null;
  @ApiProperty()
  hasBefore!: boolean;
  @ApiProperty()
  hasAfter!: boolean;
}
export class FloorWindowResponseDto extends DiscussionWindowBaseDto {
  @ApiProperty({
    type: [FloorResponseDto],
    description: '自然编号顺序窗口，最多 limit 条；置顶也仅在其自然编号位置',
  })
  items!: FloorResponseDto[];
  @ApiProperty({
    type: [FloorResponseDto],
    description:
      '仅默认首屏返回最多十条置顶；消费者保留置顶区时须按 ID 抑制 items 重复，直接定位时清空置顶区',
  })
  pinnedItems!: FloorResponseDto[];
}
export class ReplyWindowResponseDto extends DiscussionWindowBaseDto {
  @ApiProperty({ type: [ReplyResponseDto] })
  items!: ReplyResponseDto[];
  @ApiProperty({ type: [FloorResponseDto], description: '楼中楼恒为空数组' })
  pinnedItems!: FloorResponseDto[];
}
