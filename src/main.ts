/**
 * 应用入口：Fastify + Pino + Swagger + Sentry + 限流
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { SwaggerModule } from '@nestjs/swagger';
import fastifyHelmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { createOpenApiDocument } from './common/swagger/openapi-document';
import configuration from './config/configuration';

async function bootstrap() {
  const runtime = configuration();
  // Sentry 错误监控：配置 DSN 时启用
  if (runtime.sentry.dsn) {
    Sentry.init({
      dsn: runtime.sentry.dsn,
      environment: runtime.app.nodeEnv,
      tracesSampleRate: runtime.app.nodeEnv === 'production' ? 0.1 : 1.0,
    });
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors({
    origin: runtime.app.corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    exposedHeaders: ['X-Request-ID', 'X-API-Contract-Version', 'Retry-After'],
  });
  await app.register(fastifyHelmet);
  await app.register(fastifyCookie as any);

  // Swagger 文档：仅当开启时挂载，与 NODE_ENV 解耦，方便线上移动端开发
  if (runtime.app.apiDocsEnabled) {
    const document = createOpenApiDocument(app);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = runtime.port;
  await app.listen(port, '0.0.0.0');
  const logger = app.get(Logger);
  logger.log(`温油站 API running on http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
