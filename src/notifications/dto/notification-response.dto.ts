import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ type: String, nullable: true })
  content!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  payload!: Record<string, unknown> | null;

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
