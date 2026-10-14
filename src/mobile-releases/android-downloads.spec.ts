import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { mockDeep } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_MODE_KEY } from '../auth/decorators/auth-mode.constants';
import { AndroidDownloadsService } from './android-downloads.service';
import { AndroidDownloadsController } from './android-downloads.controller';
import { MobileReleasesController } from './mobile-releases.controller';
import { MobileReleasesService } from './mobile-releases.service';

const url = 'https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-1.0.0-42.apk';
const promotion = {
  apkSha256: 'a'.repeat(64),
  apkSize: '123',
  release: { versionName: '1.0.0', publishedAt: new Date('2026-10-15T00:00:00Z') },
};

describe('Android 存储桶直连信息', () => {
  const prisma = mockDeep<PrismaService>();
  let values: Record<string, unknown>;
  let service: AndroidDownloadsService;
  beforeEach(() => {
    jest.clearAllMocks();
    values = {
      'mobileCompatibility.android.recommendedBuild': 42,
      'mobileCompatibility.android.updateUrl': url,
    };
    service = new AndroidDownloadsService(prisma, {
      get: (key: string) => values[key],
    } as ConfigService);
    prisma.mobileReleasePromotion.findFirst.mockResolvedValue(promotion as never);
  });
  it('读取当前推荐的成功发布记录，直连原桶且不依赖网关目录', async () => {
    const result = await service.info();
    expect(result).toMatchObject({
      status: 'available',
      retryAfterSeconds: null,
      release: {
        downloadUrl: url,
        sizeBytes: 123,
        sha256: 'a'.repeat(64),
        buildNumber: 42,
        applicationId: 'site.wenyou.app',
        fileName: 'wenyou-1.0.0-42.apk',
      },
    });
    expect(prisma.mobileReleasePromotion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'SUCCEEDED',
          updateUrl: url,
          release: { platform: 'android', buildNumber: 42, publishedAt: { not: null } },
        },
      }),
    );
  });
  it('撤回推荐不从历史记录重新推荐', async () => {
    values['mobileCompatibility.android.recommendedBuild'] = undefined;
    expect(await service.info()).toEqual({
      status: 'no_release',
      release: null,
      retryAfterSeconds: null,
    });
    expect(prisma.mobileReleasePromotion.findFirst).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    'https://wenyou.site/api/v1/app-downloads/android/42/file',
    'https://evil.invalid/mobile/android/wenyou-1.0.0-42.apk',
  ])('缺失或未切换的策略 %s 不回退网关', async (updateUrl) => {
    values['mobileCompatibility.android.updateUrl'] = updateUrl;
    expect((await service.info()).status).toBe('unavailable');
    expect(prisma.mobileReleasePromotion.findFirst).not.toHaveBeenCalled();
  });
  it.each([
    { apkSha256: 'invalid' },
    { apkSize: '123e0' },
    { apkSize: '536870913' },
    { release: { ...promotion.release, versionName: '2.0.0' } },
    { release: { ...promotion.release, publishedAt: null } },
  ])('缺失或不匹配的身份不可下载 %j', async (invalid) => {
    prisma.mobileReleasePromotion.findFirst.mockResolvedValue({
      ...promotion,
      ...invalid,
    } as never);
    expect((await service.info()).status).toBe('unavailable');
  });
  it('未完成发布或缺失记录不可下载', async () => {
    prisma.mobileReleasePromotion.findFirst.mockResolvedValue(null);
    expect((await service.info()).status).toBe('unavailable');
  });
  it('查询失败仅返回固定错误，不暴露内部连接信息', async () => {
    prisma.mobileReleasePromotion.findFirst.mockRejectedValue(
      new Error('private connection detail'),
    );
    await expect(service.info()).rejects.toThrow(
      new ServiceUnavailableException('下载信息暂不可用'),
    );
  });
  it('同源匿名 JSON 不缓存，不签发 Cookie，静态路由不落入构建详情', async () => {
    const module = await Test.createTestingModule({
      controllers: [MobileReleasesController, AndroidDownloadsController],
      providers: [
        { provide: MobileReleasesService, useValue: { published: jest.fn() } },
        { provide: AndroidDownloadsService, useValue: service },
      ],
    }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    try {
      app.setGlobalPrefix('api/v1');
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/mobile-releases/android/download',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.json().release.downloadUrl).toBe(url);
      expect(Reflect.getMetadata(AUTH_MODE_KEY, AndroidDownloadsController.prototype.info)).toBe(
        'public',
      );
    } finally {
      await app.close();
    }
  });
});
