import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  ValidateIf,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FONT_FAMILY_PATTERN, FONT_VERSION_PATTERN } from '../font-protocol';
import { FontJobDto } from './font-admin.dto';

export const FONT_LANGUAGES = ['zh', 'ja', 'en', 'other'] as const;
export type FontLanguage = (typeof FONT_LANGUAGES)[number];
export const FONT_MANAGEMENT_STATUSES = ['draft', 'enabled', 'disabled', 'withdrawn'] as const;
export const FONT_MANAGEMENT_SORTS = ['createdAt', 'updatedAt', 'name', 'sortOrder'] as const;

export class CreateFontSubmissionDto {
  @ApiProperty({
    format: 'uuid',
    description: '客户端为一次提交生成并持久化 UUID v4；超时、刷新和并发重试复用。',
  })
  @IsUUID('4')
  submissionId!: string;

  @ApiProperty({ minLength: 1, maxLength: 80 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ enum: FONT_LANGUAGES, default: 'other' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(FONT_LANGUAGES)
  language: FontLanguage = 'other';

  @ApiPropertyOptional({
    pattern: FONT_FAMILY_PATTERN,
    description: '为已有家族上传新版时提供；须同时提供 expectedFamilyRevision。',
  })
  @ValidateIf(
    (object: CreateFontSubmissionDto) =>
      object.familyId !== undefined || object.expectedFamilyRevision !== undefined,
  )
  @Matches(new RegExp(FONT_FAMILY_PATTERN))
  familyId?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1 })
  @ValidateIf(
    (object: CreateFontSubmissionDto) =>
      object.familyId !== undefined || object.expectedFamilyRevision !== undefined,
  )
  @IsInt()
  @Min(1)
  expectedFamilyRevision?: number;
}

export class ProcessFontSubmissionDto {
  @ApiProperty({
    format: 'uuid',
    description: '一次启动/重试意图的 UUID v4；网络重发复用，用户明确再次重试才生成新值。',
  })
  @IsUUID('4')
  requestId!: string;
}

export class FontSubmissionDto {
  @ApiProperty({ format: 'uuid' })
  submissionId!: string;
  @ApiProperty({ pattern: FONT_FAMILY_PATTERN })
  familyId!: string;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: '当前家族修订；首次源上传使用此值。已绑定源的重放不重新校验旧修订。',
  })
  familyRevision!: number;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: FONT_LANGUAGES })
  language!: FontLanguage;
  @ApiProperty({ type: 'integer' })
  sortOrder!: number;
  @ApiProperty({
    enum: ['admin-font-upload-v1'],
    description:
      '上传即确认分发、转码和分片；服务端记录实际上传者、时间及源 SHA，不能替代字体原始许可。',
  })
  authorizationRuleVersion!: 'admin-font-upload-v1';
  @ApiProperty({
    type: FontJobDto,
    nullable: true,
    description: 'null 表示尚未完成源绑定；非 null 时无需重传，直接恢复查询/处理。',
  })
  job!: FontJobDto | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class FontManagementQueryDto {
  @ApiPropertyOptional({
    maxLength: 80,
    description:
      '管理展示名称包含匹配；已发布按最后当前版本、未发布按草稿。NFC、去首尾空白、不区分大小写，%/_ 按文字处理。',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString()
  @MaxLength(80)
  q?: string;
  @ApiPropertyOptional({ enum: FONT_LANGUAGES })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(FONT_LANGUAGES)
  language?: FontLanguage;
  @ApiPropertyOptional({ enum: FONT_MANAGEMENT_STATUSES })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(FONT_MANAGEMENT_STATUSES)
  status?: (typeof FONT_MANAGEMENT_STATUSES)[number];
  @ApiPropertyOptional({ enum: FONT_MANAGEMENT_SORTS, default: 'createdAt' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(FONT_MANAGEMENT_SORTS)
  sort: (typeof FONT_MANAGEMENT_SORTS)[number] = 'createdAt';
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'desc';
  @ApiPropertyOptional({
    maxLength: 2048,
    description: '不透明游标，绑定规范筛选、排序及管理列表修订；变化返回 409/40931，从第一页重取。',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(2048)
  cursor?: string;
}

export class FontManagementItemDto {
  @ApiProperty({ pattern: FONT_FAMILY_PATTERN })
  familyId!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: FONT_LANGUAGES })
  language!: FontLanguage;
  @ApiProperty({ type: 'integer' })
  sortOrder!: number;
  @ApiProperty({ type: 'integer', minimum: 1 })
  revision!: number;
  @ApiProperty()
  enabled!: boolean;
  @ApiProperty({
    enum: FONT_MANAGEMENT_STATUSES,
    description: '最后当前版本已撤回优先；从未发布为 draft，否则按家族 enabled 分类。',
  })
  status!: (typeof FONT_MANAGEMENT_STATUSES)[number];
  @ApiProperty({ type: String, nullable: true, pattern: FONT_VERSION_PATTERN })
  currentVersionId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    pattern: FONT_VERSION_PATTERN,
    description: '最后被设为当前的已发布版本，含撤回墓碑；不是按版本号猜测。',
  })
  lastPublishedVersionId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: '家族修改时间；心跳和仅任务进度变化不作为排序修改。',
  })
  updatedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt!: string | null;
  @ApiProperty({ type: FontJobDto, nullable: true })
  latestJob!: FontJobDto | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  latestSubmissionId!: string | null;
}

export class FontManagementPageDto {
  @ApiProperty({ type: [FontManagementItemDto], maxItems: 20 })
  items!: FontManagementItemDto[];
  @ApiProperty({ type: 'integer', minimum: 0, description: '先对全量家族筛选，再计算匹配数量。' })
  total!: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  listingRevision!: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  catalogRevision!: number;
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class FontOrderItemDto {
  @ApiProperty({ pattern: FONT_FAMILY_PATTERN })
  @Matches(new RegExp(FONT_FAMILY_PATTERN))
  familyId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  expectedFamilyRevision!: number;
}

export class FontOrderGroupDto {
  @ApiProperty({ enum: FONT_LANGUAGES, description: '当前已发布版本的语言，与公开目录一致。' })
  @IsIn(FONT_LANGUAGES)
  language!: FontLanguage;
  @ApiProperty({
    type: [FontOrderItemDto],
    maxItems: 10000,
    description: '此语言全部当前可选家族，数组顺序为最终展示顺序；不能只提交当前分页或搜索结果。',
  })
  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => FontOrderItemDto)
  items!: FontOrderItemDto[];
}

export class ReorderFontsDto {
  @ApiProperty({
    type: [FontOrderGroupDto],
    minItems: 1,
    maxItems: 4,
    description: '本次变更的语言组，语言不得重复；所有组一次事务提交。',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => FontOrderGroupDto)
  groups!: FontOrderGroupDto[];
  @ApiProperty({ type: 'integer', minimum: 0 })
  @IsInt()
  @Min(0)
  expectedCatalogRevision!: number;
}

export class FontReorderResultDto {
  @ApiProperty({ type: 'integer', minimum: 0 })
  catalogRevision!: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  listingRevision!: number;
  @ApiProperty({ description: '顺序未变为 false，不产生修订或审计；有变化后客户端刷新列表。' })
  changed!: boolean;
}
