import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiceRollResponseDto, PostAuthorResponseDto } from '../../posts/dto/post-response.dto';

class ThreadBodyPostResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: [DiceRollResponseDto] })
  diceRolls!: DiceRollResponseDto[];
}

class ThreadSubthreadCountResponseDto {
  @ApiProperty({ minimum: 0 })
  posts!: number;
}

class ThreadSubthreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ enum: ['PARTICIPANTS', 'COLLABORATORS', 'PLAYERS'] })
  postingPolicy!: 'PARTICIPANTS' | 'COLLABORATORS' | 'PLAYERS';

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastPostAt!: Date | null;

  @ApiProperty({ type: ThreadBodyPostResponseDto, nullable: true })
  bodyPost!: ThreadBodyPostResponseDto | null;

  @ApiProperty({ type: ThreadSubthreadCountResponseDto })
  _count!: ThreadSubthreadCountResponseDto;

  @ApiProperty({ type: [Object], description: '子贴标签关联' })
  tags!: object[];
}

class ThreadCountResponseDto {
  @ApiProperty({ minimum: 0 })
  members!: number;

  @ApiProperty({ minimum: 0 })
  posts!: number;

  @ApiProperty({ minimum: 0 })
  players!: number;
}

/** 主题详情显式契约，供 Web 与 Flutter 获取正文骰子状态。 */
export class ThreadDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty()
  ownerId!: string;

  @ApiProperty({ enum: ['DEDUCTION', 'NATION', 'RPG'] })
  category!: 'DEDUCTION' | 'NATION' | 'RPG';

  @ApiProperty({ enum: ['RECRUITING', 'CLOSED', 'FINISHED'] })
  status!: 'RECRUITING' | 'CLOSED' | 'FINISHED';

  @ApiProperty({ enum: ['PUBLIC', 'PRIVATE'] })
  visibility!: 'PUBLIC' | 'PRIVATE';

  @ApiProperty()
  published!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt!: Date | null;

  @ApiProperty()
  pinned!: boolean;

  @ApiProperty()
  viewCount!: number;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty()
  likeCount!: number;

  @ApiProperty({ type: String, nullable: true })
  defaultSubthreadId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: PostAuthorResponseDto })
  owner!: PostAuthorResponseDto;

  @ApiProperty({ type: [ThreadSubthreadResponseDto] })
  subthreads!: ThreadSubthreadResponseDto[];

  @ApiProperty({ type: [Object], description: '平台主题标签关联' })
  topicTags!: object[];

  @ApiProperty({ type: ThreadCountResponseDto })
  _count!: ThreadCountResponseDto;

  @ApiPropertyOptional()
  isBookmarked?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  bookmarkId?: string | null;

  @ApiPropertyOptional()
  isLiked?: boolean;
}
