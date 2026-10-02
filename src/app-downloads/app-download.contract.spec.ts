import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppDownloadsModule } from './app-downloads.module';
import 'reflect-metadata';
import { AUTH_MODE_KEY } from '../auth/decorators/auth-mode.constants';
import { AppDownloadsController } from './app-downloads.controller';
import { APK_RESPONSE_HEADERS, DOWNLOAD_LIMITS, downloadUrl } from './app-download.contract';

describe('匿名下载契约', () => {
  it.each(['info', 'file', 'head'] as const)('%s 不解析身份', (method) => {
    expect(Reflect.getMetadata(AUTH_MODE_KEY, AppDownloadsController.prototype[method])).toBe(
      'public',
    );
  });
  it('固定构建文件地址与旧 APP 身份头保持分离', () => {
    expect(downloadUrl(42)).toBe('https://wenyou.site/api/v1/app-downloads/android/42/file');
    expect(Object.keys(APK_RESPONSE_HEADERS)).toEqual(
      expect.arrayContaining([
        'Content-Disposition',
        'Content-Length',
        'x-amz-meta-apk-sha256',
        'x-amz-meta-application-id',
        'x-amz-meta-version-name',
        'x-amz-meta-version-code',
      ]),
    );
    expect(DOWNLOAD_LIMITS.globalBytesPerSecond * 8).toBe(4_000_000);
  });
});

describe('主 API 的默认 Fastify 路由注册', () => {
  it('显式 HEAD 与自动 HEAD 不冲突且主 API 始终 fail closed', async () => {
    const module = await Test.createTestingModule({ imports: [AppDownloadsModule] }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    try {
      app.setGlobalPrefix('api/v1');
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await app.inject({ method, url: '/api/v1/app-downloads/android/42/file' });
        expect(response.statusCode).toBe(503);
      }
    } finally {
      await app.close();
    }
  });
});
