import './instrument';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FontWorkerModule } from './text-fonts/font-worker.module';

async function bootstrap() {
  if (!process.getuid?.()) throw new Error('font_worker_requires_non_root');
  const app = await NestFactory.createApplicationContext(FontWorkerModule);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  new Logger('FontWorkerBootstrap').log('字体 Worker 已启动 workerConcurrency=1');
}
void bootstrap();
