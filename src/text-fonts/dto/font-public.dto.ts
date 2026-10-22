import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  FONT_FAMILY_PATTERN,
  FONT_FORMATS,
  FONT_RELEASE_PATTERN,
  FONT_SHA_PATTERN,
  FONT_VERSION_PATTERN,
  FontAssetFormat,
} from '../font-protocol';

export class FontCatalogQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 200,
    default: 100,
    description:
      '最多项数；服务端按完整 UTF-8 JSON 信封 65536 字节上限提前截页，必须跟随 nextCursor。',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({
    maxLength: 512,
    description:
      '服务端不透明游标，绑定 releaseId、revision、limit；目录变化返回 409/40927，清空游标重取。',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class FontAssetDto {
  @ApiProperty({ pattern: FONT_SHA_PATTERN })
  sha256!: string;
  @ApiProperty({ type: 'integer', minimum: 1 })
  bytes!: number;
  @ApiProperty({ enum: FONT_FORMATS })
  format!: FontAssetFormat;
}

export class FontCatalogEntryDto {
  @ApiProperty({ pattern: FONT_FAMILY_PATTERN })
  familyId!: string;
  @ApiProperty({ pattern: FONT_VERSION_PATTERN })
  versionId!: string;
  @ApiProperty({ maxLength: 80 })
  name!: string;
  @ApiProperty({ enum: ['zh', 'ja', 'en', 'other'] })
  designLanguage!: 'zh' | 'ja' | 'en' | 'other';
  @ApiProperty({ type: 'integer' })
  sortOrder!: number;
  @ApiProperty({ enum: [true] })
  selectable!: true;
  @ApiProperty({ enum: [true] })
  pasteAllowed!: true;
  @ApiProperty({ enum: [true] })
  renderAllowed!: true;
  @ApiProperty({
    description:
      '本站 API 相对路径；资源为 assetBasePath + sha256 + 点 + format。禁止任意外部 URL。',
  })
  assetBasePath!: string;
  @ApiProperty({ type: FontAssetDto, description: 'PNG 样张；选择器不为预览下载字体分片。' })
  specimen!: FontAssetDto;
}

export class FontCatalogPageDto {
  @ApiProperty({ enum: [2] })
  fontVersion!: 2;
  @ApiProperty({ pattern: FONT_RELEASE_PATTERN })
  releaseId!: string;
  @ApiProperty({ type: 'integer', minimum: 0 })
  revision!: number;
  @ApiProperty({ type: [FontCatalogEntryDto] })
  items!: FontCatalogEntryDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class FontVersionDescriptorDto {
  @ApiProperty({ enum: [2] })
  fontVersion!: 2;
  @ApiProperty({ pattern: FONT_VERSION_PATTERN })
  versionId!: string;
  @ApiProperty({ pattern: FONT_FAMILY_PATTERN })
  familyId!: string;
  @ApiProperty({ type: 'integer', minimum: 1 })
  versionNumber!: number;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: ['zh', 'ja', 'en', 'other'] })
  designLanguage!: 'zh' | 'ja' | 'en' | 'other';
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: '最新全局状态修订；比旧缓存优先。显式 withdrawn 为不可逆墓碑。',
  })
  revision!: number;
  @ApiProperty({ enum: ['published', 'disabled', 'withdrawn', 'preview'] })
  status!: 'published' | 'disabled' | 'withdrawn' | 'preview';
  @ApiProperty({ description: '只有当前启用家族的当前发布版本可从选择器新选。' })
  selectable!: boolean;
  @ApiProperty({
    description: '启用家族的未撤回历史已发布版本可粘贴/扩写；停用、撤回及仅预览版本不可。',
  })
  pasteAllowed!: boolean;
  @ApiProperty({
    description: '停用及历史版本可呈现；撤回禁止呈现与下载，保留正文源。preview 仅管理员可呈现。',
  })
  renderAllowed!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '撤回为 null；其他状态指向本站受状态校验的下载网关。',
  })
  assetBasePath!: string | null;
  @ApiProperty({
    type: FontAssetDto,
    nullable: true,
    description: '按需获取的单版本分片清单；撤回为 null。',
  })
  manifest!: FontAssetDto | null;
  @ApiProperty({ type: FontAssetDto, nullable: true })
  specimen!: FontAssetDto | null;
}
