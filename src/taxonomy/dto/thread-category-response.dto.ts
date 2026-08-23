import { ApiProperty } from '@nestjs/swagger';
import {
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_MIN_LENGTH,
  CATEGORY_SLUG_PATTERN_SOURCE,
} from '../category-slug';

export class ThreadCategoryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    example: 'MYSTERY',
    minLength: CATEGORY_SLUG_MIN_LENGTH,
    maxLength: CATEGORY_SLUG_MAX_LENGTH,
    pattern: CATEGORY_SLUG_PATTERN_SOURCE,
  })
  slug!: string;

  @ApiProperty({ example: '悬疑推理' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'search',
    deprecated: true,
    description: '兼容预留字段；文本分类不使用图标键',
  })
  icon!: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    deprecated: true,
    description: '合并目标分类 ID；未合并时为 null',
  })
  mergedIntoId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
