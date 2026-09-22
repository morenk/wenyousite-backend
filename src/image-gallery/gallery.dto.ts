import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { MediaDisplayResponseDto } from '../media/dto/media-display.dto';

export enum GalleryScope {
  SUBTHREAD = 'SUBTHREAD',
  POST_REPLIES = 'POST_REPLIES',
  MOMENT = 'MOMENT',
  MOMENT_COMMENTS = 'MOMENT_COMMENTS',
  MOMENT_REPLIES = 'MOMENT_REPLIES',
}
export class GalleryQueryDto {
  @ApiProperty({ enum: GalleryScope }) @IsEnum(GalleryScope) scope!: GalleryScope;
  @ApiProperty() @IsString() @MaxLength(64) scopeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) anchorId?: string;
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  anchorIndex?: number;
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  anchorVersion?: number;
  @ApiPropertyOptional({ enum: ReplyOrder }) @IsOptional() @IsEnum(ReplyOrder) order?: ReplyOrder;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) authorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(8192) cursor?: string;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
export class GalleryImageDto {
  @ApiProperty() id!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() sourceVersion!: number;
  @ApiProperty({ minimum: 0 }) imageIndex!: number;
  @ApiProperty() imageCount!: number;
  @ApiProperty({ type: String, nullable: true }) mediaId!: string | null;
  @ApiProperty() url!: string;
  @ApiProperty({ type: MediaDisplayResponseDto, nullable: true })
  display!: MediaDisplayResponseDto | null;
  @ApiProperty({ type: Number, nullable: true }) width!: number | null;
  @ApiProperty({ type: Number, nullable: true }) height!: number | null;
  @ApiProperty() animated!: boolean;
  @ApiProperty({ type: String, nullable: true }) threadId!: string | null;
  @ApiProperty({ type: String, nullable: true }) subthreadId!: string | null;
  @ApiProperty({ type: String, nullable: true }) parentPostId!: string | null;
  @ApiProperty({ type: String, nullable: true }) momentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) parentCommentId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) floorNumber!: number | null;
}
export class GalleryPageDto {
  @ApiProperty({ type: [GalleryImageDto] }) items!: GalleryImageDto[];
  @ApiProperty({ type: String, nullable: true }) previousCursor!: string | null;
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty({ type: String, nullable: true }) anchorItemId!: string | null;
}
