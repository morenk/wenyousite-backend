import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ModerationAppealStatus,
  ModerationCaseStatus,
  ModerationDecisionAction,
  NotificationCampaignStatus,
  ReportReasonCode,
  ReportTargetType,
  UserRole,
} from '@prisma/client';

export class AdminChallengeResponseDto {
  @ApiProperty({ format: 'uuid' })
  challengeId!: string;

  @ApiProperty({ example: 600 })
  expiresIn!: number;
}

export class AdminSessionResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  session!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  user!: Record<string, unknown>;

  @ApiProperty()
  csrfToken!: string;
}

export class AdminStepUpResponseDto {
  @ApiProperty({ format: 'date-time' })
  elevatedUntil!: Date;
}

export class AdminInviteCreatedResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}

export class AdminAccountsResponseDto {
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  accounts!: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  invites!: Record<string, unknown>[];
}

export class ModerationCaseResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ReportTargetType })
  targetType!: ReportTargetType;

  @ApiProperty()
  targetId!: string;

  @ApiProperty({ enum: ModerationCaseStatus })
  status!: ModerationCaseStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  reports!: Record<string, unknown>[];

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  decisions!: Record<string, unknown>[];
}

export class ModerationDecisionPublicResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ReportTargetType })
  targetType!: ReportTargetType;

  @ApiProperty()
  targetId!: string;

  @ApiProperty({ enum: ModerationDecisionAction })
  action!: ModerationDecisionAction;

  @ApiProperty({ enum: ReportReasonCode })
  policyCode!: ReportReasonCode;

  @ApiProperty()
  publicExplanation!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  appeal!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class AppealAccessTokenResponseDto {
  @ApiProperty({ description: '仅可用于用户申诉接口的短期 Bearer JWT' })
  appealToken!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}

class ModerationAppealDecisionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ReportTargetType })
  targetType!: ReportTargetType;

  @ApiProperty()
  targetId!: string;

  @ApiProperty({ enum: ModerationDecisionAction })
  action!: ModerationDecisionAction;

  @ApiProperty({ enum: ReportReasonCode })
  policyCode!: ReportReasonCode;

  @ApiProperty()
  publicExplanation!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

class ModerationAppealAppellantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;
}

export class ModerationAppealResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  statement!: string;

  @ApiProperty({ enum: ModerationAppealStatus })
  status!: ModerationAppealStatus;

  @ApiProperty({ type: ModerationAppealDecisionResponseDto })
  decision!: ModerationAppealDecisionResponseDto;

  @ApiProperty({ type: ModerationAppealAppellantResponseDto })
  appellant!: ModerationAppealAppellantResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class SiteOperationalSettingsResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  registrationPausedUntil!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  contentWritesPausedUntil!: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  maintenanceTitle!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  maintenanceContent!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  maintenanceStartsAt!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  maintenanceEndsAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class NotificationCampaignResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ enum: NotificationCampaignStatus })
  status!: NotificationCampaignStatus;

  @ApiProperty({ format: 'date-time' })
  scheduledAt!: Date;

  @ApiProperty()
  estimatedCount!: number;

  @ApiProperty()
  recipientCount!: number;

  @ApiPropertyOptional({ enum: UserRole })
  audienceRole?: UserRole;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  createdBy?: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
