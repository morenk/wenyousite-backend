import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { AndroidDownloadInfoDto } from '../app-downloads/app-download.dto';
import { AndroidDownloadsService } from './android-downloads.service';

@ApiTags('Mobile Releases')
@Controller('mobile-releases/android')
export class AndroidDownloadsController {
  constructor(private readonly downloads: AndroidDownloadsService) {}

  @Get('download')
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'mobileReleasesAndroidDownload',
    summary: '读取 Android 推荐版本及存储桶直连地址',
    description:
      '仅返回受限发布完成的当前推荐制品。无推荐为 no_release；策略尚未切回存储桶、记录缺失或身份不匹配为 unavailable。该入口不访问对象存储、不代理 APK、不签发网关 Cookie。客户端显式点击后直连桶校验 HEAD，再原生 GET；限额及缓存遵循存储桶响应。',
  })
  @ApiOkResponse({ type: AndroidDownloadInfoDto })
  @ApiResponse({ status: 503, description: '发布记录暂不可读，不回退旧网关或任意 URL' })
  info() {
    return this.downloads.info();
  }
}
