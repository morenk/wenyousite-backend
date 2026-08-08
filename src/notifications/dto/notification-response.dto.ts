import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const NOTIFICATION_TYPES = [
  'reply',
  'mention',
  'new_floor',
  'subthread_created',
  'new_post',
  'thread_created',
  'follow',
  'like',
  'tip',
  'level_up',
  'system',
] as const;

export type NotificationResponseType = (typeof NOTIFICATION_TYPES)[number];

export class NotificationLikerResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  username!: string;
}

/** 所有通知共用的结构化展示字段；未知新增字段由客户端忽略。 */
export class NotificationPayloadResponseDto {
  @ApiProperty({ enum: [1] })
  schemaVersion!: 1;

  @ApiPropertyOptional({ type: String, nullable: true })
  action?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  actorId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  actorName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  preview?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  subthreadTitle?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  threadTitle?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1 })
  totalCount?: number | null;

  @ApiPropertyOptional({ type: NotificationLikerResponseDto, isArray: true })
  likers?: NotificationLikerResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^\\d+$' })
  grossAmount?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^\\d+$' })
  recipientAmount?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: '^\\d+$' })
  platformAmount?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 9 })
  previousLevel?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 9 })
  level?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  experience?: number | null;
}

export class NotificationTargetResponseDto {
  @ApiProperty({ enum: ['post', 'thread', 'user', 'none'] })
  kind!: 'post' | 'thread' | 'user' | 'none';

  @ApiProperty({ type: String, nullable: true })
  threadId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  postId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  userId!: string | null;
}

class NotificationPostResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: Number, nullable: true })
  floorNumber!: number | null;

  @ApiProperty({ type: String, nullable: true })
  parentPostId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

class NotificationThreadResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

class NotificationFromUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;

  @ApiProperty({ minimum: 1, maximum: 9 })
  level!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: NOTIFICATION_TYPES })
  type!: NotificationResponseType;

  @ApiProperty({ type: String, nullable: true })
  content!: string | null;

  @ApiProperty({ type: NotificationPayloadResponseDto, nullable: true })
  payload!: NotificationPayloadResponseDto | null;

  @ApiProperty({ type: NotificationTargetResponseDto })
  target!: NotificationTargetResponseDto;

  @ApiProperty({ type: String, nullable: true })
  postId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  threadId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  fromUserId!: string | null;

  @ApiProperty()
  eventKey!: string;

  @ApiProperty()
  isRead!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: NotificationPostResponseDto, nullable: true })
  post!: NotificationPostResponseDto | null;

  @ApiProperty({ type: NotificationThreadResponseDto, nullable: true })
  thread!: NotificationThreadResponseDto | null;

  @ApiProperty({ type: NotificationFromUserResponseDto, nullable: true })
  fromUser!: NotificationFromUserResponseDto | null;
}

export class UnreadNotificationCountResponseDto {
  @ApiProperty({ minimum: 0 })
  unreadCount!: number;
}
