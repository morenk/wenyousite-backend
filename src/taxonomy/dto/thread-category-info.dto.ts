import { ApiProperty } from '@nestjs/swagger';
import {
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_MIN_LENGTH,
  CATEGORY_SLUG_PATTERN_SOURCE,
} from '../category-slug';

/** 随主题帖返回的当前分类展示信息；选择项仍以 GET /thread-categories 为准。 */
export class ThreadCategoryInfoDto {
  @ApiProperty({
    example: 'MYSTERY',
    minLength: CATEGORY_SLUG_MIN_LENGTH,
    maxLength: CATEGORY_SLUG_MAX_LENGTH,
    pattern: CATEGORY_SLUG_PATTERN_SOURCE,
  })
  slug!: string;

  @ApiProperty({ example: '悬疑推理', description: '分类注册表中的当前名称' })
  name!: string;

  @ApiProperty({ description: '当前是否允许新主题选择该分类' })
  isActive!: boolean;
}
