import { ApiProperty } from '@nestjs/swagger';
import { PostAuthorResponseDto } from '../../posts/dto/post-response.dto';
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

export class ThreadListItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true, example: 'MYSTERY', description: '动态分类 slug' })
  category!: string | null;

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
