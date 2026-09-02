import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsString, IsUUID, Min } from 'class-validator';
import { IsCuid } from '../../common/decorators/is-cuid.decorator';

export class ImportStickerMediaDto {
  @ApiProperty({ description: '已处理完成、且属于当前用户的媒体 ID' })
  @IsString()
  @IsCuid()
  mediaId!: string;

  @ApiProperty({ format: 'uuid', description: '导入幂等键' })
  @IsUUID('4')
  clientRequestId!: string;
}

export class ImportStickerDirectMessageDto {
  @ApiProperty({ description: '当前用户参与的、尚未撤回的私聊消息 ID' })
  @IsString()
  @IsCuid()
  directMessageId!: string;

  @ApiProperty({ format: 'uuid', description: '导入幂等键' })
  @IsUUID('4')
  clientRequestId!: string;
}

export class ImportStickerPostImageDto {
  @ApiProperty({ description: '当前用户可访问的帖子 ID' })
  @IsString()
  @IsCuid()
  postId!: string;

  @ApiProperty({ description: '帖子正文中图片的完整 URL' })
  @IsString()
  imageUrl!: string;

  @ApiProperty({ format: 'uuid', description: '导入幂等键' })
  @IsUUID('4')
  clientRequestId!: string;
}

export class ImportStickerMomentImageDto {
  @ApiProperty({ description: '当前用户可访问动态中的图片媒体 ID 所属动态' })
  @IsString()
  @IsCuid()
  momentId!: string;

  @ApiProperty({ description: '动态图片的媒体 ID' })
  @IsString()
  @IsCuid()
  mediaId!: string;

  @ApiProperty({ format: 'uuid', description: '导入幂等键' })
  @IsUUID('4')
  clientRequestId!: string;
}

export class ImportStickerMomentCommentImageDto {
  @ApiProperty({ description: '当前用户可访问动态中的评论 ID' })
  @IsString()
  @IsCuid()
  momentCommentId!: string;

  @ApiProperty({ description: '动态评论图片的媒体 ID' })
  @IsString()
  @IsCuid()
  mediaId!: string;

  @ApiProperty({ format: 'uuid', description: '导入幂等键' })
  @IsUUID('4')
  clientRequestId!: string;
}

export class ReorderStickersDto {
  @ApiProperty({ minimum: 1, description: 'GET /stickers 返回的收藏夹版本' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ type: String, isArray: true, maxItems: 200 })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsCuid({ each: true })
  favoriteIds!: string[];
}

export class StickerAssetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  thumbnailUrl!: string;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty()
  animated!: boolean;

  @ApiProperty()
  frameCount!: number;

  @ApiProperty()
  durationMs!: number;
}

export class UserStickerResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  position!: number;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastUsedAt!: Date | null;

  @ApiProperty({ type: StickerAssetResponseDto })
  asset!: StickerAssetResponseDto;

  @ApiProperty({ description: '插入编辑器时使用的标准 Markdown' })
  markdown!: string;
}

export class StickerImportResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['PROCESSING', 'COMPLETED', 'FAILED'] })
  status!: 'PROCESSING' | 'COMPLETED' | 'FAILED';

  @ApiPropertyOptional({ type: UserStickerResponseDto, nullable: true })
  favorite!: UserStickerResponseDto | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  failureCode!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  failureMessage!: string | null;

  @ApiProperty()
  alreadySaved!: boolean;
}

export class StickerCollectionResponseDto {
  @ApiProperty()
  version!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty({ type: UserStickerResponseDto, isArray: true })
  items!: UserStickerResponseDto[];

  @ApiProperty({ type: UserStickerResponseDto, isArray: true })
  recent!: UserStickerResponseDto[];

  @ApiProperty({ type: StickerImportResponseDto, isArray: true })
  pendingImports!: StickerImportResponseDto[];
}
