import './instrument';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import sharp from 'sharp';
import { ImageWorkerModule } from './media/image-worker.module';

async function bootstrap() {
  sharp.concurrency(1);
  const app = await NestFactory.createApplicationContext(ImageWorkerModule);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  new Logger('ImageWorkerBootstrap').log(
    `图片 Worker 已启动 workerConcurrency=2 sharpConcurrency=${sharp.concurrency()}`,
  );
}

void bootstrap();
