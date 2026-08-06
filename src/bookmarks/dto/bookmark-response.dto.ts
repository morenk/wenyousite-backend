import { ApiProperty } from '@nestjs/swagger';

/** 新建收藏后的稳定跨端响应。 */
export class BookmarkResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
