import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AndroidDownloadInfoDto } from '../app-downloads/app-download.dto';
import { artifactSchema, publicInfo } from '../app-downloads/download-model';

@Injectable()
export class AndroidDownloadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async info(): Promise<AndroidDownloadInfoDto> {
    const buildNumber = this.config.get<number>('mobileCompatibility.android.recommendedBuild');
    const updateUrl = this.config.get<string>('mobileCompatibility.android.updateUrl');
    const unavailable: AndroidDownloadInfoDto = {
      status: 'unavailable',
      release: null,
      retryAfterSeconds: null,
    };
    if (!buildNumber) return { ...unavailable, status: 'no_release' };
    // 策略仍指向旧网关时，必须先经受限晋级验证源站，再开放直连入口。
    if (!updateUrl?.startsWith('https://wenyou-apk.cn-nb1.rains3.com/mobile/android/'))
      return unavailable;

    const promotion = await this.prisma.mobileReleasePromotion
      .findFirst({
        where: {
          status: 'SUCCEEDED',
          updateUrl,
          release: { platform: 'android', buildNumber, publishedAt: { not: null } },
        },
        orderBy: { createdAt: 'desc' },
        include: { release: { select: { versionName: true, publishedAt: true } } },
      })
      .catch(() => {
        throw new ServiceUnavailableException('下载信息暂不可用');
      });
    if (!promotion?.release.publishedAt || !/^[1-9][0-9]*$/.test(promotion.apkSize))
      return unavailable;
    const artifact = artifactSchema.safeParse({
      schemaVersion: 1,
      applicationId: 'site.wenyou.app',
      versionName: promotion.release.versionName,
      buildNumber,
      sizeBytes: Number(promotion.apkSize),
      sha256: promotion.apkSha256,
      bucket: 'wenyou-apk',
      key: 'mobile/android/wenyou-' + promotion.release.versionName + '-' + buildNumber + '.apk',
      legacyUpdateUrl: updateUrl,
    });
    if (!artifact.success) return unavailable;
    return {
      status: 'available',
      release: {
        ...publicInfo(artifact.data, promotion.release.publishedAt.toISOString()),
        downloadUrl: artifact.data.legacyUpdateUrl,
      },
      retryAfterSeconds: null,
    };
  }
}
