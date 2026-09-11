import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostAuthorResponseDto } from '../../posts/dto/post-response.dto';
import { ThreadCategoryInfoDto } from '../../taxonomy/dto/thread-category-info.dto';
import { ThreadTagRelationResponseDto } from './thread-detail-response.dto';

class ThreadListDefaultSubthreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastPostAt!: Date | null;
}

class ThreadListCountResponseDto {
  @ApiProperty({ minimum: 0 })
  members!: number;

  @ApiProperty({ minimum: 0 })
  players!: number;

  @ApiProperty({ minimum: 0 })
  posts!: number;
}

export class ThreadCoverPreviewVariantResponseDto {
  @ApiProperty({ description: '已发布的不可变列表动画 WebP 地址；不用于替换正文原图 URL' })
  url!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 800, description: '单帧实际像素宽度' })
  width!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 800, description: '单帧实际像素高度' })
  height!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: '完整动画预览文件字节数' })
  bytes!: number;
}

export class ThreadCoverMediaResponseDto {
  @ApiProperty({ description: '第一张普通正文图片的原始播放地址，与 coverImages[0] 一致；未知媒体不得自动请求' })
  url!: string;

  @ApiProperty({ type: Boolean, nullable: true, description: '可信的动画属性；无法确认、未完成或历史 GIF 返回 null' })
  animated!: boolean | null;

  @ApiProperty({ type: String, nullable: true, description: '可用于列表静止状态的第一帧静态地址；未知时返回 null，客户端显示占位，禁止回退加载原图' })
  posterUrl!: string | null;

  @ApiPropertyOptional({
    type: [ThreadCoverPreviewVariantResponseDto], nullable: true, maxItems: 2,
    description: '可选列表动画变体，按单帧像素面积升序；缺失或 null 时，只有已确认 animated=true 且有独立静态 poster 的媒体可受控回退原 url',
  })
  previewVariants?: ThreadCoverPreviewVariantResponseDto[] | null;
}

export class ThreadListItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: 'MYSTERY', description: '动态分类 slug' })
  category!: string | null;

  @ApiProperty({
    type: ThreadCategoryInfoDto,
    nullable: true,
    description: '分类展示读模型；名称来自当前分类注册表，历史未知 slug 使用 slug 兜底',
  })
  categoryInfo!: ThreadCategoryInfoDto | null;

  @ApiProperty({ enum: ['RECRUITING', 'CLOSED', 'FINISHED'] })
  status!: 'RECRUITING' | 'CLOSED' | 'FINISHED';

  @ApiProperty({ enum: ['PUBLIC', 'PRIVATE'] })
  visibility!: 'PUBLIC' | 'PRIVATE';

  @ApiProperty()
  published!: boolean;

  @ApiProperty()
  pinned!: boolean;

  @ApiProperty({ type: String, pattern: '^\\d+$', description: '用户投入的累计打赏升数' })
  tipTotal!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: PostAuthorResponseDto })
  owner!: PostAuthorResponseDto;

  @ApiProperty({ type: ThreadListDefaultSubthreadResponseDto, nullable: true })
  defaultSubthread!: ThreadListDefaultSubthreadResponseDto | null;

  @ApiProperty({ type: [ThreadTagRelationResponseDto] })
  topicTags!: ThreadTagRelationResponseDto[];

  @ApiProperty({ type: ThreadListCountResponseDto })
  _count!: ThreadListCountResponseDto;

  @ApiProperty({ description: '默认主贴正文的纯文本预览' })
  preview!: string;

  @ApiProperty({
    type: [String],
    maxItems: 1,
    description: '默认主贴正文中的第一张普通图片 URL；无图时返回空数组',
  })
  coverImages!: string[];

  @ApiProperty({ type: ThreadCoverMediaResponseDto, nullable: true, description: '第一张普通正文图片的封面读模型；无图时返回 null。旧服务可能省略，消费者须兼容缺字段' })
  coverMedia!: ThreadCoverMediaResponseDto | null;
}

/** 保留首页专用 schema 名称；字段统一继承主题帖列表卡片契约。 */
export class HomeThreadListItemResponseDto extends ThreadListItemResponseDto {}

/** 公开收藏保留原 schema 名称，不返回私有收藏记录元数据。 */
export class BookmarkThreadResponseDto extends ThreadListItemResponseDto {}

/** 本人的收藏管理列表在通用卡片之外携带可操作的收藏记录元数据。 */
export class OwnBookmarkThreadResponseDto extends ThreadListItemResponseDto {
  @ApiProperty({ description: '收藏记录 ID' })
  bookmarkId!: string;

  @ApiProperty({ description: '所属收藏夹 ID' })
  bookmarkFolderId!: string;
}

class DraftDefaultSubthreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;
}

class DraftThreadCountResponseDto {
  @ApiProperty({ minimum: 0 })
  subthreads!: number;

  @ApiProperty({ minimum: 0 })
  posts!: number;
}

export class DraftThreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: 'MYSTERY', description: '动态分类 slug' })
  category!: string | null;

  @ApiProperty({ type: ThreadCategoryInfoDto, nullable: true })
  categoryInfo!: ThreadCategoryInfoDto | null;

  @ApiProperty({ enum: ['RECRUITING', 'CLOSED', 'FINISHED'] })
  status!: 'RECRUITING' | 'CLOSED' | 'FINISHED';

  @ApiProperty({ enum: ['PUBLIC', 'PRIVATE'] })
  visibility!: 'PUBLIC' | 'PRIVATE';

  @ApiProperty()
  published!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  defaultSubthreadId!: string | null;

  @ApiProperty({ type: DraftDefaultSubthreadResponseDto, nullable: true })
  defaultSubthread!: DraftDefaultSubthreadResponseDto | null;

  @ApiProperty({ type: [ThreadTagRelationResponseDto] })
  topicTags!: ThreadTagRelationResponseDto[];

  @ApiProperty({ type: DraftThreadCountResponseDto })
  _count!: DraftThreadCountResponseDto;
}
