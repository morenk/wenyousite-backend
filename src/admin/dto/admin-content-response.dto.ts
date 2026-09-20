import { ApiProperty } from '@nestjs/swagger';
import {
  AdminAuditLogResponseDto,
  AdminHiddenContentUserResponseDto,
  AdminUserModerationResponseDto,
} from './moderation-response.dto';
import { ADMIN_CONTENT_TYPES, AdminContentType } from './admin-content.dto';
import { MediaDisplayResponseDto } from '../../media/dto/media-display.dto';

export class AdminContentTagDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
}
export class AdminContentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ADMIN_CONTENT_TYPES }) type!: AdminContentType;
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: AdminHiddenContentUserResponseDto })
  author!: AdminHiddenContentUserResponseDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
  @ApiProperty() hidden!: boolean;
  @ApiProperty() parentHidden!: boolean;
  @ApiProperty() canRestore!: boolean;
  @ApiProperty({ type: String, nullable: true }) restoreBlockedReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) threadId!: string | null;
  @ApiProperty({ type: String, nullable: true }) parentPostId!: string | null;
  @ApiProperty({ type: String, nullable: true }) momentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) parentCommentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) category!: string | null;
  @ApiProperty({ type: AdminContentTagDto, isArray: true }) tags!: AdminContentTagDto[];
  @ApiProperty({ type: Number, nullable: true }) version!: number | null;
}
export class AdminContentMediaDto {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ type: MediaDisplayResponseDto, nullable: true })
  display!: MediaDisplayResponseDto | null;
}
export class AdminContentDetailResponseDto extends AdminContentResponseDto {
  @ApiProperty() content!: string;
  @ApiProperty({ type: String, isArray: true }) mediaIds!: string[];
  @ApiProperty({ type: AdminContentMediaDto, isArray: true }) media!: AdminContentMediaDto[];
  @ApiProperty({ type: AdminAuditLogResponseDto, isArray: true })
  auditLogs!: AdminAuditLogResponseDto[];
}
export class AdminUserContentCountsDto {
  @ApiProperty() thread!: number;
  @ApiProperty() post!: number;
  @ApiProperty() moment!: number;
  @ApiProperty() moment_comment!: number;
}
export class AdminUserDetailResponseDto extends AdminUserModerationResponseDto {
  @ApiProperty({ type: String, nullable: true }) bio!: string | null;
  @ApiProperty() level!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) lastActiveDate!: string | null;
  @ApiProperty({ type: AdminUserContentCountsDto }) contentCounts!: AdminUserContentCountsDto;
}
