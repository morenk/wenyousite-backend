import { Controller, Get, Header, Headers, Param, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import {
  FontCatalogPageDto,
  FontCatalogQueryDto,
  FontVersionDescriptorDto,
} from './dto/font-public.dto';
import { DynamicFontRuntimePolicyDto } from './dto/font-runtime.dto';
import { DYNAMIC_FONT_RUNTIME_POLICY } from './font-runtime-policy';
import { FontQueryService } from './font-query.service';
import { fontAssetResponse, fontMetadataResponse } from './font-http';

@ApiTags('Meta')
@Controller('meta/text-fonts/v2')
@Public()
export class TextFontsV2Controller {
  constructor(private readonly fonts: FontQueryService) {}

  @Get('runtime-policy')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOkResponse({ type: DynamicFontRuntimePolicyDto })
  getRuntimePolicy(): DynamicFontRuntimePolicyDto {
    return structuredClone(DYNAMIC_FONT_RUNTIME_POLICY);
  }

  @Get()
  @Header('Cache-Control', 'no-cache')
  @ApiOkResponse({ type: FontCatalogPageDto, headers: { ETag: { schema: { type: 'string' } } } })
  @ApiResponse({ status: 304, description: 'If-None-Match 命中当前页；无响应体。' })
  async getCatalog(
    @Query() query: FontCatalogQueryDto,
    @Headers('if-none-match') etag: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<FontCatalogPageDto | void> {
    return fontMetadataResponse(await this.fonts.catalog(query), etag, reply);
  }

  @Get('versions/:versionId')
  @Header('Cache-Control', 'no-cache')
  @ApiOkResponse({
    type: FontVersionDescriptorDto,
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiResponse({ status: 304, description: '状态未变化；无响应体。' })
  async getVersion(
    @Param('versionId') versionId: string,
    @Headers('if-none-match') etag: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<FontVersionDescriptorDto | void> {
    return fontMetadataResponse(await this.fonts.version(versionId), etag, reply);
  }

  @Get('versions/:versionId/assets/:asset')
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    description:
      'asset=sha256.format；只有该版本清单列出的对象可读。字节内容不可变，响应 no-cache，撤回返回 410/41001。',
  })
  async getAsset(
    @Param('versionId') versionId: string,
    @Param('asset') asset: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    fontAssetResponse(await this.fonts.asset(versionId, asset), reply);
  }
}
