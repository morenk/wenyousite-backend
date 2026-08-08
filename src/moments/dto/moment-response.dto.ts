import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostAuthorResponseDto } from '../../posts/dto/post-response.dto';

const COVER_THEMES = ['ROSE', 'LILAC', 'MINT', 'AMBER'] as const;

export class MomentMediaResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ type: String, nullable: true })
  thumbnailUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  feedUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  mediumUrl!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;
}

export class MomentActionResponseDto {
  @ApiProperty()
  momentId!: string;

  @ApiProperty({ minimum: 0 })
  count!: number;

  @ApiProperty()
  active!: boolean;
}

export class MomentCardResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  authorId!: string;

  @ApiProperty({ type: PostAuthorResponseDto })
  author!: PostAuthorResponseDto;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: '纯文本正文摘要' })
  contentExcerpt!: string;

  @ApiProperty({ enum: ['IMAGE', 'TEXT'] })
  coverType!: 'IMAGE' | 'TEXT';

  @ApiProperty({ enum: COVER_THEMES })
  textCoverTheme!: (typeof COVER_THEMES)[number];

  @ApiProperty({ type: MomentMediaResponseDto, nullable: true })
  coverMedia!: MomentMediaResponseDto | null;

  @ApiProperty({ minimum: 0, maximum: 9 })
  imageCount!: number;

  @ApiProperty({ minimum: 0 })
  likeCount!: number;

  @ApiProperty({ minimum: 0 })
  commentCount!: number;

  @ApiProperty({ minimum: 0 })
  bookmarkCount!: number;

  @ApiProperty({ type: String, pattern: '^\\d+$' })
  tipTotal!: string;

  @ApiProperty()
  viewerLiked!: boolean;

  @ApiProperty()
  viewerBookmarked!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class MomentDetailResponseDto extends MomentCardResponseDto {
  @ApiProperty({ description: '完整纯文本正文' })
  content!: string;

  @ApiProperty({ type: [MomentMediaResponseDto] })
  images!: MomentMediaResponseDto[];

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty()
  canEdit!: boolean;

  @ApiProperty()
  canDelete!: boolean;
}

export class MomentReplyTargetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: PostAuthorResponseDto })
  author!: PostAuthorResponseDto;
}

export class MomentStickerResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  thumbnailUrl!: string;

  @ApiProperty()
  mediumUrl!: string;

  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;

  @ApiProperty()
  animated!: boolean;

  @ApiProperty()
  frameCount!: number;

  @ApiProperty()
  durationMs!: number;
}

export class MomentCommentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  momentId!: string;

  @ApiProperty({ type: PostAuthorResponseDto })
  author!: PostAuthorResponseDto;

  @ApiProperty({ type: String, nullable: true, description: '图片/表情评论可为空字符串；删除后为 null' })
  content!: string | null;

  @ApiProperty({ type: MomentMediaResponseDto, nullable: true, description: '每条评论最多一张普通图片' })
  media!: MomentMediaResponseDto | null;

  @ApiProperty({ type: MomentStickerResponseDto, nullable: true, description: '每条评论最多一个表情；与 media 互斥' })
  sticker!: MomentStickerResponseDto | null;

  @ApiProperty({ type: String, nullable: true, description: '楼中楼统一指向主评论' })
  parentCommentId!: string | null;

  @ApiProperty({ type: MomentReplyTargetResponseDto, nullable: true })
  replyToComment!: MomentReplyTargetResponseDto | null;

  @ApiProperty()
  deleted!: boolean;

  @ApiProperty()
  canDelete!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class MomentRootCommentResponseDto extends MomentCommentResponseDto {
  @ApiProperty({ minimum: 0 })
  replyCount!: number;

  @ApiProperty({ type: [MomentCommentResponseDto], description: '按当前筛选与顺序返回的前三条可见楼中楼预览' })
  replies!: MomentCommentResponseDto[];
}

export class MomentDeleteResponseDto {
  @ApiProperty()
  message!: string;
}

export class MomentSearchResponseDto extends MomentCardResponseDto {
  @ApiPropertyOptional({ type: Number, description: '仅用于说明结果相关度；客户端不得作为稳定业务字段依赖' })
  relevance?: number;
}
