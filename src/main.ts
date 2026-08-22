/**
 * 应用入口：Fastify + Pino + Swagger + Sentry + 限流
 */
import './instrument';
import { NestFactory } from '@nestjs/core';
import type { IncomingMessage } from 'http';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { SwaggerModule } from '@nestjs/swagger';
import fastifyHelmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import { AppModule } from './app.module';
import { createOpenApiDocument } from './common/swagger/openapi-document';
import { requestIdFromHeader } from './common/http/request-id';
import configuration from './config/configuration';
import { adminCsrfCookieName } from './admin/admin-auth.constants';

async function bootstrap() {
  const runtime = configuration();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // Caddy 与应用同机部署：仅信任 loopback 反代传入的 X-Forwarded-For。
    new FastifyAdapter({
      trustProxy: ['127.0.0.1', '::1'],
      genReqId: (request: IncomingMessage) => requestIdFromHeader(request.headers['x-request-id']),
    }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
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
  const production = runtime.app.nodeEnv === 'production';
  await app.register(fastifyCsrf, {
    cookieKey: adminCsrfCookieName(production),
    cookieOpts: {
      httpOnly: true,
      secure: production,
      sameSite: 'strict',
      path: '/api/v1/admin',
    },
    getToken: (request) => {
      const token = request.headers['x-csrf-token'];
      return Array.isArray(token) ? token[0] : token;
    },
  });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    const path = request.url.split('?', 1)[0];
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    const publicAdminAuth = new Set(['/api/v1/admin/auth/challenge', '/api/v1/admin/auth/verify']);
    if (!mutating || !path.startsWith('/api/v1/admin/') || publicAdminAuth.has(path)) {
      done();
      return;
    }
    fastify.csrfProtection(request, reply, done);
  });

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
