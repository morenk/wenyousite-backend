import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_MIN_LENGTH,
  CATEGORY_SLUG_PATTERN,
  CATEGORY_SLUG_PATTERN_SOURCE,
  normalizeCategorySlugValue,
  trimStringValue,
} from '../category-slug';

export class CreateThreadCategoryDto {
  @ApiProperty({
    example: 'MYSTERY',
    description: '稳定机器标识；服务端会去除首尾空白并转为大写，创建后不可修改',
    minLength: CATEGORY_SLUG_MIN_LENGTH,
    maxLength: CATEGORY_SLUG_MAX_LENGTH,
    pattern: CATEGORY_SLUG_PATTERN_SOURCE,
  })
  @Transform(({ value }) => normalizeCategorySlugValue(value))
  @IsString()
  @Matches(CATEGORY_SLUG_PATTERN)
  slug!: string;

  @ApiProperty({ example: '悬疑推理', minLength: 1, maxLength: 50 })
  @Transform(({ value }) => trimStringValue(value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({
    example: 'search',
    maxLength: 50,
    deprecated: true,
    description: '兼容旧管理客户端；文本分类不再使用图标键',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 500, description: '管理员审计原因' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateThreadCategoryDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @Transform(({ value }) => trimStringValue(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @ApiPropertyOptional({
    type: String,
    maxLength: 50,
    nullable: true,
    deprecated: true,
    description: '兼容旧管理客户端；文本分类不再使用图标键',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ maxLength: 500, description: '管理员审计原因' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
