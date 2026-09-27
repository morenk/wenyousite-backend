import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CursorPaginationDto } from '../common/dto/pagination.dto';

export const RELEASE_PLATFORMS = ['android'] as const;
export class MobileReleaseIdentityDto {
  @ApiProperty({ enum: RELEASE_PLATFORMS })
  @IsIn(RELEASE_PLATFORMS)
  platform!: 'android';

  @ApiProperty({ minLength: 1, maxLength: 64, pattern: '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$' })
  @Matches(/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/)
  versionName!: string;

  @ApiProperty({ minimum: 1, maximum: 2100000000 })
  @IsInt()
  @Min(1)
  @Max(2100000000)
  buildNumber!: number;
}
export class MobileReleaseContentDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 200,
    description: '纯文本摘要；至少含一个非空白字符，不解析 Markdown/HTML',
  })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/u)
  summary!: string;

  @ApiProperty({
    type: 'array',
    minItems: 1,
    maxItems: 30,
    items: { type: 'string', minLength: 1, maxLength: 500 },
    description: '1–30 条纯文本，每条最多 500 字符且非空白；客户端按文本显示',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @Matches(/\S/u, { each: true })
  items!: string[];
}
export class CreateMobileReleaseDto extends MobileReleaseIdentityDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/u)
  summary!: string;

  @ApiProperty({
    type: 'array',
    minItems: 1,
    maxItems: 30,
    items: { type: 'string', minLength: 1, maxLength: 500 },
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @Matches(/\S/u, { each: true })
  items!: string[];
}
export class MobileReleaseRevisionDto {
  @ApiProperty({
    minimum: 1,
    maximum: 2147483646,
    description: '最后读取的编辑 revision；竞争返回 HTTP 409，重新读取后再操作',
  })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  revision!: number;
}
export class UpdateMobileReleaseDto extends MobileReleaseContentDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 64,
    pattern: '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$',
    description: '仅从未确认的草稿允许修正版本名；平台/build 固定',
  })
  @IsOptional()
  @Matches(/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/)
  versionName?: string;

  @ApiProperty({ minimum: 1, maximum: 2147483646 })
  @IsInt()
  @Min(1)
  @Max(2147483646)
  revision!: number;
}
export class MobileReleaseQueryDto extends CursorPaginationDto {
  @ApiProperty({ enum: RELEASE_PLATFORMS })
  @IsIn(RELEASE_PLATFORMS)
  platform!: 'android';
}
export class MobileReleaseBuildDto {
  @ApiProperty({ enum: RELEASE_PLATFORMS })
  @IsIn(RELEASE_PLATFORMS)
  platform!: 'android';

  @ApiProperty({ minimum: 1, maximum: 2100000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2100000000)
  buildNumber!: number;
}
export class MobileReleaseSnapshotDto extends MobileReleaseContentDto {
  @ApiProperty() revision!: number;
  @ApiProperty({ format: 'date-time' }) confirmedAt!: string;
}
export class PublicMobileReleaseDto extends MobileReleaseIdentityDto {
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [String] }) items!: string[];
  @ApiProperty() revision!: number;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
}
export class AdminMobileReleaseDto extends MobileReleaseIdentityDto {
  @ApiProperty() id!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [String] }) items!: string[];
  @ApiProperty() revision!: number;
  @ApiProperty({
    enum: ['DRAFT', 'READY', 'PUBLISHED'],
    description:
      '已发布记录即使有待确认修正仍为 PUBLISHED；hasUnconfirmedChanges 表示草稿与确认快照不同',
  })
  status!: string;
  @ApiProperty() hasUnconfirmedChanges!: boolean;
  @ApiProperty() publishing!: boolean;
  @ApiProperty({ type: MobileReleaseSnapshotDto, nullable: true })
  confirmed!: MobileReleaseSnapshotDto | null;
  @ApiProperty({ type: PublicMobileReleaseDto, nullable: true })
  published!: PublicMobileReleaseDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
