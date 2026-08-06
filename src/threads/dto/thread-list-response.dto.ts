import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiProperty({ enum: ['DEDUCTION', 'NATION', 'RPG'] })
  category!: 'DEDUCTION' | 'NATION' | 'RPG';

  @ApiProperty({ enum: ['RECRUITING', 'CLOSED', 'FINISHED'] })
  status!: 'RECRUITING' | 'CLOSED' | 'FINISHED';

  @ApiProperty({ enum: ['PUBLIC', 'PRIVATE'] })
  visibility!: 'PUBLIC' | 'PRIVATE';

  @ApiProperty()
  published!: boolean;

  @ApiProperty()
  pinned!: boolean;

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

  @ApiPropertyOptional({ description: '首页列表正文预览；用户活动列表可能不返回' })
  preview?: string;
}

export class HomeThreadListItemResponseDto extends ThreadListItemResponseDto {
  @ApiProperty({ description: '首页列表正文预览' })
  declare preview: string;
}

class BookmarkThreadCountResponseDto {
  @ApiProperty({ minimum: 0 })
  members!: number;

  @ApiProperty({ minimum: 0 })
  posts!: number;
}

export class BookmarkThreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ['DEDUCTION', 'NATION', 'RPG'] })
  category!: 'DEDUCTION' | 'NATION' | 'RPG';

  @ApiProperty({ enum: ['RECRUITING', 'CLOSED', 'FINISHED'] })
  status!: 'RECRUITING' | 'CLOSED' | 'FINISHED';

  @ApiProperty({ enum: ['PUBLIC', 'PRIVATE'] })
  visibility!: 'PUBLIC' | 'PRIVATE';

  @ApiProperty()
  published!: boolean;

  @ApiProperty()
  pinned!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: PostAuthorResponseDto })
  owner!: PostAuthorResponseDto;

  @ApiProperty({ type: BookmarkThreadCountResponseDto })
  _count!: BookmarkThreadCountResponseDto;

  @ApiPropertyOptional({ description: '查看自己的收藏时返回收藏记录 ID' })
  bookmarkId?: string;
}

export class OwnBookmarkThreadResponseDto extends BookmarkThreadResponseDto {
  @ApiProperty({ description: '收藏记录 ID' })
  declare bookmarkId: string;
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

  @ApiProperty({ enum: ['DEDUCTION', 'NATION', 'RPG'] })
  category!: 'DEDUCTION' | 'NATION' | 'RPG';

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
