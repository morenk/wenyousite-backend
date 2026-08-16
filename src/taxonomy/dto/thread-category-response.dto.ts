import { ApiProperty } from '@nestjs/swagger';

export class ThreadCategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'MYSTERY' })
  slug!: string;

  @ApiProperty({ example: '悬疑推理' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'search' })
  icon!: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '合并目标分类 ID；未合并时为 null',
  })
  mergedIntoId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
