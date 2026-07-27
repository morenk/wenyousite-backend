/** 应用入口：创建 NestJS 应用实例，配置 Fastify 适配器、日志和全局前缀 */
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  // 使用 Fastify 替代默认 Express，性能更高
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  // 使用 Pino 结构化日志，替换 NestJS 默认日志
  app.useLogger(app.get(Logger));
  // 统一 API 前缀：/api/v1
  app.setGlobalPrefix('api/v1');
  // 允许跨域，开发阶段全放开
  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`温油站 API running on http://localhost:${port}`);
}
bootstrap();
