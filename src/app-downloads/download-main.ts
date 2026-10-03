import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { AppDownloadsController, DOWNLOAD_HANDLER } from './app-downloads.controller';
import { DownloadBudget, DownloadInstanceLock } from './download-budget';
import { DownloadCache } from './download-cache';
import { DownloadGateway } from './download-gateway';
import {
  DownloadConfig,
  ledgerPath,
  loadDownloadConfig,
  downloadBudgetLimits,
  downloadQuotaLimits,
} from './download-config';
import { assertDownload } from './download-model';
import { gatewayEnvironmentSafe } from '../config/configuration';
import { DownloadDevice } from './download-device';

export async function startDownloadGateway(config: DownloadConfig) {
  const lock = new DownloadInstanceLock(join(config.DOWNLOAD_EGRESS_DIR, 'gateway-lock.sqlite'));
  let budget: DownloadBudget | undefined,
    gateway: DownloadGateway | undefined,
    app: NestFastifyApplication | undefined;
  try {
    budget = new DownloadBudget(
      ledgerPath(config, 'egress'),
      'egress',
      downloadBudgetLimits(config, 'egress'),
      downloadQuotaLimits(config),
    );
    gateway = new DownloadGateway(
      budget,
      new DownloadCache(config.DOWNLOAD_CACHE_DIR, config.DOWNLOAD_CATALOG_DIR),
      new DownloadDevice(budget.deviceKeys(), config.DOWNLOAD_PREVIEW_RUN_ID),
    );
    const instance = gateway;
    @Module({
      controllers: [AppDownloadsController],
      providers: [{ provide: DOWNLOAD_HANDLER, useValue: gateway }],
    })
    class GatewayModule {}
    class GatewayAdapter extends FastifyAdapter {
      setNotFoundHandler() {
        return this.getInstance().setNotFoundHandler((request, reply) =>
          instance.handle(request, reply),
        );
      }
      setErrorHandler() {
        return this.getInstance().setErrorHandler((_error, request, reply) =>
          instance.handle(request, reply),
        );
      }
    }
    const adapter = new GatewayAdapter({
      logger: false,
      bodyLimit: 1024,
      connectionTimeout: 15_000,
      requestTimeout: 5000,
      routerOptions: { maxParamLength: 100 },
      exposeHeadRoutes: false,
    });
    app = await NestFactory.create<NestFastifyApplication>(GatewayModule, adapter, {
      logger: false,
      abortOnError: false,
    });
    app.setGlobalPrefix('api/v1');
    const fastify = adapter.getInstance();
    fastify.get('/__metrics', (request, reply) => instance.handle(request, reply));
    fastify.get('/__health', (request, reply) => instance.handle(request, reply));
    fastify.server.maxConnections = 32;
    await app.init();
    // 从不 unlink 已有 socket；systemd 清理运行目录，避免第二实例替换活动入口。
    await app.listen({ path: config.DOWNLOAD_SOCKET });
    await chmod(config.DOWNLOAD_SOCKET, 0o660);
    let closing = false;
    return {
      gateway: instance,
      async close() {
        if (closing) return;
        closing = true;
        instance.close();
        await app!.close();
        budget!.close();
        lock.close();
      },
    };
  } catch (error) {
    gateway?.close();
    await app?.close();
    budget?.close();
    lock.close();
    throw error;
  }
}
async function main() {
  const args = process.argv.slice(2);
  assertDownload(args.length === 2 && args[0] === '--env' && gatewayEnvironmentSafe());
  const config = await loadDownloadConfig(args[1]);
  const server = await startDownloadGateway(config);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(
      signal,
      () =>
        void server
          .close()
          .then(() => {
            process.exitCode = 0;
          })
          .catch(() => {
            process.exitCode = 1;
          }),
    );
  process.stdout.write('DOWNLOAD_GATEWAY_READY\n');
}
if (require.main === module)
  void main().catch(() => {
    process.stderr.write('DOWNLOAD_GATEWAY_FAILED\n');
    process.exitCode = 1;
  });
