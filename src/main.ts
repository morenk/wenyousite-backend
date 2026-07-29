/**
 * 应用入口：Fastify + Pino + Swagger + Sentry + 限流
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import fastifyHelmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';

async function bootstrap() {
  // Sentry 错误监控：配置 DSN 时启用
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
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
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });
  await app.register(fastifyHelmet);
  await app.register(fastifyCookie as any);

  // Swagger 文档：仅当开启时挂载，与 NODE_ENV 解耦，方便线上移动端开发
  if (process.env.ENABLE_API_DOCS !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('温油站 API')
      .setDescription('温油站共同创作社区后端接口文档 | [前端接入指南](../docs/frontend-guide.md)')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addTag('Auth', '认证 — 注册、登录、Token 刷新、会话管理')
      .addTag('Users', '用户 — 资料、关注、拉黑')
      .addTag('Threads', '主题帖 — CRUD、成员管理、私密帖、邀请')
      .addTag('Subthreads', '子贴 — CRUD、排序、发帖权限')
      .addTag('Posts', '楼层 — 发帖、楼中楼、编辑、点赞')
      .addTag('Drafts', '草稿 — 5 槽位草稿池')
      .addTag('Notifications', '通知 — 列表、未读数、已读')
      .addTag('Subscriptions', '订阅 — 帖/用户粒度')
      .addTag('Bookmarks', '收藏 — 主题帖收藏')
      .addTag('Media', '媒体 — 预签名上传、缩略图')
      .addTag('Tags', '标签 — 全局标签搜索/创建')
      .addTag('Search', '搜索 — PostgreSQL ILIKE 全文')
      .addTag('ReadingProgress', '阅读进度 — 记录/新增回复数')
      .addTag('Reports', '举报 — 已搁置')
      .addTag('Health', '健康检查 — 数据库连通')
      .addTag('Admin', '管理后台 — 系统通知、用户搜索')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  const logger = app.get(Logger);
  logger.log(`温油站 API running on http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
