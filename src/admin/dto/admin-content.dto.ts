import {
  CATEGORY_SLUG_PATTERN,
  CATEGORY_SLUG_PATTERN_SOURCE,
  normalizeCategorySlugValue,
  trimStringValue,
} from '../../taxonomy/category-slug';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export const ADMIN_CONTENT_TYPES = ['thread', 'post', 'moment', 'moment_comment'] as const;
export type AdminContentType = (typeof ADMIN_CONTENT_TYPES)[number];

export class AdminContentQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: ADMIN_CONTENT_TYPES, default: 'thread' })
  @IsOptional()
  @IsIn(ADMIN_CONTENT_TYPES)
  type?: AdminContentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  id?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  authorId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'HIDDEN'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'HIDDEN'])
  status?: 'ACTIVE' | 'HIDDEN';
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdAfter?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdBefore?: string;
  @ApiPropertyOptional({ pattern: CATEGORY_SLUG_PATTERN_SOURCE, minLength: 1, maxLength: 50 })
  @Transform(({ value }) => normalizeCategorySlugValue(value))
  @IsOptional()
  @IsString()
  @Matches(CATEGORY_SLUG_PATTERN)
  category?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tagId?: string;
  @ApiPropertyOptional({ enum: [20, 50], default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([20, 50])
  declare limit?: number;
}
export class UpdateContentTaxonomyDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }) => trimStringValue(value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
  @ApiPropertyOptional({
    description: '省略保持原值，不可清空',
    pattern: CATEGORY_SLUG_PATTERN_SOURCE,
    minLength: 1,
    maxLength: 50,
  })
  @Transform(({ value }) => normalizeCategorySlugValue(value))
  @Matches(CATEGORY_SLUG_PATTERN)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  category?: string;
  @ApiPropertyOptional({ type: String, isArray: true, maxItems: 5 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  tagIds?: string[];
}
