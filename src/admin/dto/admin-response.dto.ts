import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminStatusResponseDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  docs!: string;
}

export class AdminRecipientCountResponseDto {
  @ApiProperty({ minimum: 0 })
  recipientCount!: number;

  @ApiPropertyOptional({ minimum: 0 })
  estimatedCount?: number;
}

export class AdminNotificationUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

export class AdminSystemNotificationHistoryItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  content!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  payload!: Record<string, unknown> | null;

  @ApiProperty({ type: String, nullable: true })
  threadId!: string | null;

  @ApiProperty()
  isRead!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: AdminNotificationUserResponseDto })
  user!: AdminNotificationUserResponseDto;
}

export class AdminSystemNotificationHistoryResponseDto {
  @ApiProperty({ type: AdminSystemNotificationHistoryItemDto, isArray: true })
  data!: AdminSystemNotificationHistoryItemDto[];

  @ApiProperty({ type: String, nullable: true })
  cursor!: string | null;

  @ApiProperty()
  hasMore!: boolean;
}

export class AdminUserSearchItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['USER', 'ADMIN', 'SUPER_ADMIN'] })
  role!: 'USER' | 'ADMIN' | 'SUPER_ADMIN';

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AdminUserSearchResponseDto {
  @ApiProperty({ type: AdminUserSearchItemDto, isArray: true })
  data!: AdminUserSearchItemDto[];
}
