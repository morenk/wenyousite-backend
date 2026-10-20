import { Controller, Get, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { TEXT_FONT_ASSET_INDEX } from '../common/text-font-assets.generated';

class TextFontManifestDto {
  @ApiProperty({ description: '相对于 assetBaseUrl 的不可变路径；不得解释为任意外链' })
  path!: string;

  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  sha256!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  bytes!: number;
}

function copyManifest(manifest: TextFontManifestDto | null): TextFontManifestDto | null {
  return manifest ? { ...manifest } : null;
}

class TextFontFamilyDto {
  @ApiProperty({ description: '正文 data-wenyou-font-v1 使用的固定身份' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: ['ready', 'pendingSource', 'pendingLicense'],
    description:
      'ready 表示构建产物已核验；实际加载还须 assetBaseUrl。pendingSource/pendingLicense 不可选择或新增写入。',
  })
  availability!: 'ready' | 'pendingSource' | 'pendingLicense';
}

class TextFontCatalogDto {
  @ApiProperty({ enum: [1] })
  fontVersion!: number;

  @ApiProperty()
  catalogVersion!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '运营配置的自有静态分发前缀，末尾为 /；未发布时 null，不直接访问第三方上游。',
  })
  assetBaseUrl!: string | null;

  @ApiProperty({ type: TextFontManifestDto, nullable: true })
  manifest!: TextFontManifestDto | null;

  @ApiProperty({ type: [TextFontFamilyDto] })
  fonts!: TextFontFamilyDto[];
}

@ApiTags('Meta')
@Controller('meta/text-fonts')
export class TextFontsController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOkResponse({
    type: TextFontCatalogDto,
    headers: {
      'Cache-Control': { schema: { type: 'string', example: 'public, max-age=300' } },
    },
  })
  getCatalog(): TextFontCatalogDto {
    return {
      fontVersion: 1,
      catalogVersion: TEXT_FONT_ASSET_INDEX.catalogVersion,
      assetBaseUrl: this.config.get<string>('app.textFontAssetBaseUrl') || null,
      manifest: copyManifest(TEXT_FONT_ASSET_INDEX.manifest),
      fonts: TEXT_FONT_ASSET_INDEX.fonts.map((font) => ({ ...font })),
    };
  }
}
