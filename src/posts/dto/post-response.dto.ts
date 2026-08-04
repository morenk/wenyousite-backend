/** 帖子响应 DTO：统一楼层、楼中楼和编辑器读写链路的跨端类型 */

import { ApiProperty } from '@nestjs/swagger';

const POST_KINDS = ['BODY', 'FLOOR'] as const;

/** 帖子作者摘要 */
export class PostAuthorResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;
}

/** 帖子公共字段 */
export class PostBaseResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  threadId!: string;

  @ApiProperty()
  subthreadId!: string;

  @ApiProperty()
  authorId!: string;

  @ApiProperty({ enum: POST_KINDS })
  kind!: (typeof POST_KINDS)[number];

  @ApiProperty({ type: Number, nullable: true })
  floorNumber!: number | null;

  @ApiProperty({ type: String, nullable: true })
  parentPostId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  replyToPostId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '客户端创建请求幂等键；正文帖和旧客户端帖子为 null' })
  clientRequestId!: string | null;

  @ApiProperty({ description: 'Markdown 正文' })
  content!: string;

  @ApiProperty({ minimum: 1, description: '乐观锁版本' })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

/** 创建、正文 upsert 和编辑后的帖子响应 */
export class PostResponseDto extends PostBaseResponseDto {
  @ApiProperty({ type: PostAuthorResponseDto })
  author!: PostAuthorResponseDto;
}

/** 被回复目标摘要 */
export class ReplyTargetResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  authorId!: string;

  @ApiProperty({ type: PostAuthorResponseDto })
  author!: PostAuthorResponseDto;
}

/** 楼中楼回复响应 */
export class ReplyResponseDto extends PostResponseDto {
  @ApiProperty({ type: ReplyTargetResponseDto, nullable: true })
  replyToPost!: ReplyTargetResponseDto | null;
}

/** 关联计数 */
export class PostCountResponseDto {
  @ApiProperty({ minimum: 0 })
  replies!: number;
}

/** 主楼层响应，内嵌前五条楼中楼 */
export class FloorResponseDto extends PostResponseDto {
  @ApiProperty({ type: PostCountResponseDto })
  _count!: PostCountResponseDto;

  @ApiProperty({ type: [ReplyResponseDto] })
  replies!: ReplyResponseDto[];
}

/** 帖子所属主题帖摘要 */
export class PostThreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;
}

/** 帖子所属子贴摘要 */
export class PostSubthreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;
}

/** 帖子父楼摘要 */
export class ParentPostResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Number, nullable: true })
  floorNumber!: number | null;
}

/** 帖子详情与导航上下文响应 */
export class PostDetailResponseDto extends PostResponseDto {
  @ApiProperty({ type: PostThreadResponseDto })
  thread!: PostThreadResponseDto;

  @ApiProperty({ type: PostSubthreadResponseDto })
  subthread!: PostSubthreadResponseDto;

  @ApiProperty({ type: ParentPostResponseDto, nullable: true })
  parentPost!: ParentPostResponseDto | null;

  @ApiProperty({ type: PostCountResponseDto })
  _count!: PostCountResponseDto;
}
