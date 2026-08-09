import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsIn,
  IsArray,
  IsUUID,
  Matches,
  ArrayMaxSize,
  ArrayUnique,
} from 'class-validator';
import { CATEGORY_SLUG_PATTERN } from '../../taxonomy/category-slug';
import { MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_THREAD, TAG_NAME_PATTERN } from '../../tags/tag-name';

/** 创建主题帖草稿 DTO：全部可选，发布时校验完整 */
export class CreateThreadDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '客户端创建幂等键；同一次提交和网络重试必须复用',
  })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;

  @ApiPropertyOptional({
    example: '我的第一个主题帖',
    description: '主题帖标题（可为空，发布时校验）',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({
    example: 'DEDUCTION',
    description: '管理员配置的主题帖分类 slug；草稿可暂不选择',
  })
  @IsOptional()
  @IsString()
  @Matches(CATEGORY_SLUG_PATTERN)
  category?: string;

  @ApiPropertyOptional({
    example: '这里是开场白...',
    description: '默认子贴正文（kind=BODY，可选，留空仅创建空子贴）',
    maxLength: 10000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({
    example: '主帖',
    description: '默认子贴标题（可选，不填则取主题帖标题）',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subthreadTitle?: string;

  @ApiPropertyOptional({
    example: ['无限流', '穿越'],
    description: '主题帖标签名称列表',
    maxItems: MAX_TAGS_PER_THREAD,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_THREAD)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(MAX_TAG_NAME_LENGTH, { each: true })
  @Matches(TAG_NAME_PATTERN, {
    each: true,
    message: '标签名只能包含字母、数字、下划线、中文和 #',
  })
  tagNames?: string[];

  @ApiPropertyOptional({ enum: ['PUBLIC', 'PRIVATE'], default: 'PUBLIC', description: '可见性' })
  @IsOptional()
  @IsString()
  @IsIn(['PUBLIC', 'PRIVATE'])
  visibility?: string;
}
