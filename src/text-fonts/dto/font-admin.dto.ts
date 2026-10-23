import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import {
  FONT_FAMILY_PATTERN,
  FONT_JOB_PATTERN,
  FONT_SHA_PATTERN,
  FONT_SOURCE_MAX_BYTES,
  FONT_VERSION_PATTERN,
} from '../font-protocol';

export class FontRightsDto {
  @ApiProperty()
  @IsBoolean()
  redistribution!: boolean;
  @ApiProperty()
  @IsBoolean()
  conversion!: boolean;
  @ApiProperty()
  @IsBoolean()
  subsetting!: boolean;
}

export class FontConfigurationDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
  @ApiProperty({ enum: ['zh', 'ja', 'en', 'other'] })
  @IsIn(['zh', 'ja', 'en', 'other'])
  designLanguage!: 'zh' | 'ja' | 'en' | 'other';
  @ApiProperty({ type: 'integer', minimum: -1000000, maximum: 1000000 })
  @IsInt()
  @Min(-1000000)
  @Max(1000000)
  sortOrder!: number;
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  author!: string;
  @ApiProperty({ maxLength: 2048, description: '出处链接，仅作授权凭据记录；后端从不抓取。' })
  @ValidateIf((_object, value: unknown) => value !== '')
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(2048)
  sourceUrl!: string;
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  licenseName!: string;
  @ApiProperty({
    maxLength: 65536,
    description:
      '完整授权材料；缺失或三项权利未全部确认时，只能保存草稿和上传源，不能启动处理或发布。',
  })
  @IsString()
  @MaxLength(65536)
  licenseText!: string;
  @ApiProperty({ maxLength: 200, description: '展示于 PNG 的样张文字；不允许换行或控制字符。' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[^\p{Cc}\p{Cf}]+$/u)
  specimenText!: string;
  @ApiProperty({ type: FontRightsDto })
  @ValidateNested()
  @Type(() => FontRightsDto)
  rights!: FontRightsDto;
}

export class UpdateFontConfigurationDto extends FontConfigurationDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  expectedFamilyRevision!: number;
}

export class FontSourceQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '简化提交标识；绑定已有提交、授权确认及唯一任务。省略时完全沿用旧授权流程。',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  submissionId?: string;
  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedFamilyRevision!: number;
  @ApiProperty({
    enum: ['ttf', 'otf'],
    description: '只接受单个 TTF/OTF 文件；扩展名不替代 Worker 对实际容器的验证。',
  })
  @IsIn(['ttf', 'otf'])
  format!: 'ttf' | 'otf';
}

export class FontPublishDto {
  @ApiProperty({ pattern: FONT_VERSION_PATTERN })
  @Matches(new RegExp(FONT_VERSION_PATTERN))
  versionId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  expectedFamilyRevision!: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  @IsInt()
  @Min(0)
  expectedCatalogRevision!: number;
}

export class FontEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  expectedFamilyRevision!: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  @IsInt()
  @Min(0)
  expectedCatalogRevision!: number;
}

export class FontWithdrawDto {
  @ApiProperty({ type: 'integer', minimum: 0 })
  @IsInt()
  @Min(0)
  expectedCatalogRevision!: number;
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class FontFamilyDto extends FontConfigurationDto {
  @ApiProperty({ pattern: FONT_FAMILY_PATTERN })
  familyId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 })
  revision!: number;
  @ApiProperty()
  enabled!: boolean;
  @ApiProperty({ type: String, nullable: true, pattern: FONT_VERSION_PATTERN })
  currentVersionId!: string | null;
  @ApiProperty({ type: 'integer', minimum: 0 })
  catalogRevision!: number;
}

export class FontJobDto {
  @ApiProperty({ pattern: FONT_JOB_PATTERN })
  jobId!: string;
  @ApiProperty({ pattern: FONT_FAMILY_PATTERN })
  familyId!: string;
  @ApiProperty({ enum: ['draft', 'queued', 'processing', 'ready', 'failed'] })
  status!: 'draft' | 'queued' | 'processing' | 'ready' | 'failed';
  @ApiProperty({ pattern: FONT_SHA_PATTERN })
  sourceSha256!: string;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: FONT_SOURCE_MAX_BYTES })
  sourceBytes!: number;
  @ApiProperty({ type: String, nullable: true, pattern: FONT_VERSION_PATTERN })
  versionId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: [
      'invalid-font',
      'unsupported-font',
      'rights-required',
      'resource-limit',
      'sandbox-unavailable',
      'processing-failed',
    ],
  })
  failureCode!: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    enum: ['embedding-restricted', 'subsetting-restricted', 'bitmap-only'],
    description: '固定、无原始解析错误的拒绝说明；fsType 限制即使管理员确认也不能绕过。',
  })
  failureReason?: 'embedding-restricted' | 'subsetting-restricted' | 'bitmap-only' | null;
}

export class FontAdminFamilyDetailDto extends FontFamilyDto {
  @ApiProperty({ type: [FontJobDto] })
  jobs!: FontJobDto[];
  @ApiProperty({
    type: [String],
    description: '含未发布和已撤回版本；通过管理预览描述符逐个读取。',
  })
  versionIds!: string[];
}

export class FontAdminListQueryDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 200, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
  @ApiPropertyOptional({ pattern: FONT_FAMILY_PATTERN })
  @IsOptional()
  @Matches(new RegExp(FONT_FAMILY_PATTERN))
  after?: string;
}

export class FontAdminPageDto {
  @ApiProperty({ type: [FontFamilyDto] })
  items!: FontFamilyDto[];
  @ApiProperty({ type: String, nullable: true })
  nextAfter!: string | null;
}
