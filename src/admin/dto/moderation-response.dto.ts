import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction, AuditTargetType, UserRole, UserSanctionType } from '@prisma/client';

export class AdminCapabilityResponseDto {
  @ApiProperty({ enum: [UserRole.ADMIN, UserRole.SUPER_ADMIN] })
  role!: 'ADMIN' | 'SUPER_ADMIN';

  @ApiProperty({ type: String, isArray: true })
  capabilities!: string[];
}

export class AdminUserSanctionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: UserSanctionType })
  type!: UserSanctionType;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  reportId!: string | null;
}

export class AdminUserModerationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'BANNED'] })
  moderationStatus!: 'ACTIVE' | 'SUSPENDED' | 'BANNED';

  @ApiPropertyOptional({ type: AdminUserSanctionResponseDto, nullable: true })
  currentSanction?: AdminUserSanctionResponseDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AdminContentModerationResponseDto {
  @ApiProperty({ enum: ['THREAD', 'POST', 'MOMENT', 'MOMENT_COMMENT'] })
  targetType!: 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT';

  @ApiProperty()
  targetId!: string;

  @ApiProperty()
  hidden!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;
}

export class AdminHiddenContentUserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;
}

export class AdminHiddenContentResponseDto {
  @ApiProperty({ enum: ['THREAD', 'POST', 'MOMENT', 'MOMENT_COMMENT'] })
  targetType!: 'THREAD' | 'POST' | 'MOMENT' | 'MOMENT_COMMENT';

  @ApiProperty()
  targetId!: string;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ type: AdminHiddenContentUserResponseDto })
  author!: AdminHiddenContentUserResponseDto;

  @ApiProperty({ type: AdminHiddenContentUserResponseDto, nullable: true })
  moderator!: AdminHiddenContentUserResponseDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  hiddenAt!: Date;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty()
  canRestore!: boolean;

  @ApiProperty({ type: String, nullable: true })
  restoreBlockedReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  threadId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  parentPostId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  momentId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  parentCommentId!: string | null;
}

export class AdminAuditActorResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;
}

export class AdminAuditLogResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: AuditAction })
  action!: AuditAction;

  @ApiProperty({ enum: AuditTargetType })
  targetType!: AuditTargetType;

  @ApiProperty({ type: String, nullable: true })
  targetId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reportId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ type: AdminAuditActorResponseDto, nullable: true })
  actor!: AdminAuditActorResponseDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
