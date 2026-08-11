import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

export class CreateMomentDto {
  @ApiProperty({ minLength: 2, maxLength: 40, description: '动态标题，纯文本' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  title!: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    default: '',
    description: '动态正文字串；可按 internal-reference v1 嵌入命名站内传送门，其他 Markdown 按普通文本处理',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content: string = '';

  @ApiProperty({ type: [String], maxItems: 9, default: [], description: '已完成处理的图片 ID，顺序即展示顺序' })
  @IsArray()
  @ArrayMaxSize(9)
  @ArrayUnique()
  @IsString({ each: true })
  mediaIds: string[] = [];

  @ApiPropertyOptional({ type: String, nullable: true, description: '必须属于 mediaIds；无图时为 null' })
  @IsOptional()
  @IsString()
  coverMediaId?: string | null;

  @ApiProperty({ format: 'uuid', description: '发布幂等键，同时决定无图文字封面配色' })
  @IsUUID()
  clientRequestId!: string;
}

export class UpdateMomentDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 40 })
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  title?: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: '动态正文字串；站内传送门语法见 internal-reference v1，其他 Markdown 按普通文本处理',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 9 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(9)
  @ArrayUnique()
  @IsString({ each: true })
  mediaIds?: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  coverMediaId?: string | null;

  @ApiProperty({ minimum: 1, description: '乐观锁版本' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  version!: number;
}

export class CreateMomentCommentDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: '评论字串；可按 internal-reference v1 嵌入命名站内传送门；与图片或表情至少提供一项',
  })
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(500)
  content?: string;

  @ApiPropertyOptional({ description: '已完成处理且属于评论者的图片 ID；与 stickerAssetId 互斥' })
  @IsOptional()
  @IsString()
  @IsCuid()
  mediaId?: string;

  @ApiPropertyOptional({ description: '当前收藏夹中的表情资产 ID；与 mediaId 互斥' })
  @IsOptional()
  @IsString()
  @IsCuid()
  stickerAssetId?: string;

  @ApiPropertyOptional({ description: '被回复评论 ID；服务端自动归并到所属主评论' })
  @IsOptional()
  @IsString()
  replyToCommentId?: string;

  @ApiProperty({ format: 'uuid', description: '评论幂等键' })
  @IsUUID()
  clientRequestId!: string;
}
