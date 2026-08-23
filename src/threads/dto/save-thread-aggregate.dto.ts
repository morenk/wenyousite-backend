import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';
import {
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_MIN_LENGTH,
  CATEGORY_SLUG_PATTERN,
  CATEGORY_SLUG_PATTERN_SOURCE,
  normalizeCategorySlugValue,
} from '../../taxonomy/category-slug';
import { TAG_NAME_PATTERN } from '../../tags/tag-name';

/** 原子保存主题帖编辑器中的元数据、默认正文与标签。 */
export class SaveThreadAggregateDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({
    example: 'MYSTERY',
    description: '管理员配置的分类 slug；服务端会去除首尾空白并转为大写',
    minLength: CATEGORY_SLUG_MIN_LENGTH,
    maxLength: CATEGORY_SLUG_MAX_LENGTH,
    pattern: CATEGORY_SLUG_PATTERN_SOURCE,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeCategorySlugValue(value))
  @IsString()
  @Matches(CATEGORY_SLUG_PATTERN)
  category?: string;

  @ApiPropertyOptional({ enum: ['RECRUITING', 'CLOSED', 'FINISHED'] })
  @IsOptional()
  @IsIn(['RECRUITING', 'CLOSED', 'FINISHED'])
  status?: 'RECRUITING' | 'CLOSED' | 'FINISHED';

  @ApiPropertyOptional({ enum: ['PUBLIC', 'PRIVATE'] })
  @IsOptional()
  @IsIn(['PUBLIC', 'PRIVATE'])
  visibility?: 'PUBLIC' | 'PRIVATE';

  @ApiPropertyOptional({ example: true, description: '仅允许从草稿发布，不允许撤回' })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @ApiProperty({ minimum: 1, description: '主题帖乐观锁版本' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ minimum: 1, description: '默认子贴乐观锁版本' })
  @IsInt()
  @Min(1)
  defaultSubthreadVersion!: number;

  @ApiPropertyOptional({ minimum: 1, description: '已有默认正文的乐观锁版本' })
  @IsOptional()
  @IsInt()
  @Min(1)
  bodyVersion?: number;

  @ApiProperty({ maxLength: 10000, description: '默认子贴 Markdown 正文' })
  @IsString()
  @MaxLength(10000)
  content!: string;

  @ApiProperty({ type: [String], maxItems: 5, example: ['跑团', '奇幻'] })
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(20, { each: true })
  @Matches(TAG_NAME_PATTERN, {
    each: true,
    message: '标签名只能包含字母、数字、下划线、中文和 #',
  })
  tagNames!: string[];
}
