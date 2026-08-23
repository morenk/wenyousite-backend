/** 草稿响应 DTO：供 Web/Flutter 生成草稿池强类型客户端 */

import { ApiProperty } from '@nestjs/swagger';

/** 草稿记录响应 */
export class DraftResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  slot!: number;

  @ApiProperty({ description: 'Markdown 正文' })
  content!: string;

  @ApiProperty({ minimum: 1, description: '乐观锁版本，每次覆盖后递增' })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

/** 草稿槽位使用情况响应 */
export class DraftSlotUsageResponseDto {
  @ApiProperty({ minimum: 0, maximum: 5 })
  usedSlots!: number;

  @ApiProperty({ example: 5 })
  maxSlots!: number;

  @ApiProperty({ type: [Number], description: '已占用槽位编号' })
  slots!: number[];
}

/** 草稿集合与槽位用量的同一数据库快照。 */
export class DraftStateResponseDto extends DraftSlotUsageResponseDto {
  @ApiProperty({ type: DraftResponseDto, isArray: true })
  drafts!: DraftResponseDto[];
}

/** 删除草稿响应 */
export class DeleteDraftResponseDto {
  @ApiProperty({ example: '草稿已删除' })
  message!: string;
}
