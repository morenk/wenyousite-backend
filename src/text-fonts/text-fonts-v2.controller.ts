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
import { TextFontAvailabilityService } from './text-font-availability.service';

@ApiTags('Meta')
@Controller('meta/text-fonts/v2')
@Public()
export class TextFontsV2Controller {
  constructor(private readonly fonts: TextFontAvailabilityService) {}

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
  getCatalog(
    @Query() query: FontCatalogQueryDto,
    @Headers('if-none-match') etag: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): FontCatalogPageDto {
    return this.fonts.request('catalog', query, etag, reply);
  }

  @Get('versions/:versionId')
  @Header('Cache-Control', 'no-cache')
  @ApiOkResponse({
    type: FontVersionDescriptorDto,
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiResponse({ status: 304, description: '状态未变化；无响应体。' })
  getVersion(
    @Param('versionId') versionId: string,
    @Headers('if-none-match') etag: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): FontVersionDescriptorDto {
    return this.fonts.request('version', versionId, etag, reply);
  }

  @Get('versions/:versionId/assets/:asset')
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    description:
      'asset=sha256.format；只有该版本清单列出的对象可读。字节内容不可变，响应 no-cache，撤回返回 410/41001。',
  })
  getAsset(
    @Param('versionId') versionId: string,
    @Param('asset') asset: string,
    @Res() reply: FastifyReply,
  ): void {
    this.fonts.request('asset', versionId, asset, reply);
  }
}
