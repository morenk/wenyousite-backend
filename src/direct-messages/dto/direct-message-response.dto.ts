import { ApiProperty } from '@nestjs/swagger';

export const DIRECT_CONVERSATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELED',
] as const;

export const DIRECT_REQUEST_DIRECTIONS = ['NONE', 'INCOMING', 'OUTGOING'] as const;

export class DirectMessageUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ type: String, nullable: true })
  avatar!: string | null;

  @ApiProperty()
  isDeactivated!: boolean;
}

export class DirectMessageMediaResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ type: String, nullable: true })
  contentType!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  width!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height!: number | null;
}

export class DirectMessageStickerResponseDto extends DirectMessageMediaResponseDto {
  @ApiProperty()
  thumbnailUrl!: string;

  @ApiProperty()
  animated!: boolean;

  @ApiProperty()
  frameCount!: number;

  @ApiProperty()
  durationMs!: number;
}

export class DirectMessageResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  conversationId!: string;

  @ApiProperty()
  senderId!: string;

  @ApiProperty()
  recipientId!: string;

  @ApiProperty({ type: String, nullable: true })
  content!: string | null;

  @ApiProperty({ type: DirectMessageMediaResponseDto, nullable: true })
  media!: DirectMessageMediaResponseDto | null;

  @ApiProperty({ type: DirectMessageStickerResponseDto, nullable: true })
  sticker!: DirectMessageStickerResponseDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  recalledAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class DirectMessagePreviewResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  senderId!: string;

  @ApiProperty({ type: String, nullable: true })
  contentPreview!: string | null;

  @ApiProperty()
  hasImage!: boolean;

  @ApiProperty()
  hasSticker!: boolean;

  @ApiProperty()
  isRecalled!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class DirectConversationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: DIRECT_CONVERSATION_STATUSES })
  status!: (typeof DIRECT_CONVERSATION_STATUSES)[number];

  @ApiProperty({ enum: DIRECT_REQUEST_DIRECTIONS })
  requestDirection!: (typeof DIRECT_REQUEST_DIRECTIONS)[number];

  @ApiProperty({ type: DirectMessageUserResponseDto })
  otherUser!: DirectMessageUserResponseDto;

  @ApiProperty({ type: DirectMessagePreviewResponseDto, nullable: true })
  lastMessage!: DirectMessagePreviewResponseDto | null;

  @ApiProperty({ minimum: 0 })
  unreadCount!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastMessageAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty()
  canSend!: boolean;

  @ApiProperty()
  canAccept!: boolean;

  @ApiProperty()
  canDecline!: boolean;

  @ApiProperty()
  isBlocked!: boolean;
}

export const DIRECT_CONTACT_STATES = [
  'NEW',
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELED',
  'UNAVAILABLE',
] as const;

export class DirectConversationLookupResponseDto {
  @ApiProperty({ enum: DIRECT_CONTACT_STATES })
  contactState!: (typeof DIRECT_CONTACT_STATES)[number];

  @ApiProperty()
  canInitiate!: boolean;

  @ApiProperty({ type: DirectConversationResponseDto, nullable: true })
  conversation!: DirectConversationResponseDto | null;
}

export class DirectConversationStartResponseDto {
  @ApiProperty({ type: DirectConversationResponseDto })
  conversation!: DirectConversationResponseDto;

  @ApiProperty({ type: DirectMessageResponseDto })
  message!: DirectMessageResponseDto;
}

export class DirectUnreadCountResponseDto {
  @ApiProperty({ minimum: 0 })
  unreadMessageCount!: number;

  @ApiProperty({ minimum: 0 })
  pendingRequestCount!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;
}

export class DirectMessageRecallResponseDto {
  @ApiProperty()
  message!: string;

  @ApiProperty()
  conversationCanceled!: boolean;
}
