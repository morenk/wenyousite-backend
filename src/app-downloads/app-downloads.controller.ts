import {
  Controller,
  Get,
  Head,
  Inject,
  Optional,
  Req,
  Res,
  ServiceUnavailableException,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { APK_MEDIA_TYPE, APK_RESPONSE_HEADERS } from './app-download.contract';
import { AndroidDownloadInfoDto } from './app-download.dto';

export const DOWNLOAD_HANDLER = Symbol('DOWNLOAD_HANDLER');
export interface DownloadHandler {
  handle(request: FastifyRequest, reply: FastifyReply): Promise<void>;
}
function DownloadErrors() {
  return applyDecorators(
    ApiResponse({ status: 429, description: '请求频率、并发或持久化流量预算超限；Retry-After 秒' }),
    ApiResponse({
      status: 503,
      description: '账本/目录依赖异常或网关未接通；文件缓存缺失/损坏、撤回/暂停也为 503；绝不回源',
    }),
  );
}
function FileContract() {
  return applyDecorators(
    Public(),
    ApiParam({ name: 'buildNumber', schema: { type: 'integer', minimum: 1, maximum: 2100000000 } }),
    ApiHeader({
      name: 'Range',
      required: false,
      description: '仅单段 bytes=start-end、start- 或 -suffix；非法/多段为 416',
    }),
    ApiHeader({
      name: 'If-Range',
      required: false,
      description: '匹配 ETag 或 Last-Modified 才应用 Range；不匹配发送完整文件',
    }),
    ApiResponse({
      status: 200,
      description: '已发布且已验证的完整 APK；HEAD 无正文',
      headers: APK_RESPONSE_HEADERS,
      content: { [APK_MEDIA_TYPE]: { schema: { type: 'string', format: 'binary' } } },
    }),
    ApiResponse({
      status: 206,
      description: '单段范围；HEAD 无正文',
      headers: { ...APK_RESPONSE_HEADERS, 'Content-Range': { schema: { type: 'string' } } },
      content: { [APK_MEDIA_TYPE]: { schema: { type: 'string', format: 'binary' } } },
    }),
    ApiResponse({ status: 404, description: '构建不存在或未发布' }),
    ApiResponse({
      status: 416,
      description: '非法、多段或越界 Range',
      headers: { 'Content-Range': { schema: { type: 'string' }, description: 'bytes */<总长度>' } },
    }),
    DownloadErrors(),
  );
}

@ApiTags('App Downloads')
@Controller('app-downloads')
export class AppDownloadsController {
  constructor(@Optional() @Inject(DOWNLOAD_HANDLER) private readonly gateway?: DownloadHandler) {}

  @Get('android')
  @Public()
  @ApiOperation({ summary: '匿名读取当前 Android 下载信息；仅 JSON，不预取 APK' })
  @ApiOkResponse({ type: AndroidDownloadInfoDto })
  @DownloadErrors()
  info(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    return this.dispatch(request, reply);
  }

  @Get('android/:buildNumber/file')
  @FileContract()
  file(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    return this.dispatch(request, reply);
  }

  @Head('android/:buildNumber/file')
  @FileContract()
  head(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    return this.dispatch(request, reply);
  }

  private dispatch(request: FastifyRequest, reply: FastifyReply) {
    // 主 API 保留契约及 fail-closed 路由；只有独立网关注入文件发送能力。
    if (!this.gateway) throw new ServiceUnavailableException('下载服务暂不可用');
    return this.gateway.handle(request, reply);
  }
}
