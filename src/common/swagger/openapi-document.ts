import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applySuccessResponseEnvelope } from './success-response-envelope';
import { applyErrorResponseEnvelope } from './error-response-envelope';

/** 破坏性 API 变更时递增；Web 与 Flutter 生成客户端均记录该版本。 */
export const API_CONTRACT_VERSION = '3.0.0-dev.20260807.1';

type AuthMode = 'public' | 'optional' | 'authenticated' | 'verified' | 'admin';

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

function applyAuthSemantics(document: ReturnType<typeof SwaggerModule.createDocument>) {
  const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
  for (const path of Object.values(document.paths)) {
    for (const method of methods) {
      const operation = path[method];
      if (!operation) continue;
      const mode = (operation as typeof operation & Record<string, unknown>)['x-auth-mode'] as AuthMode | undefined;
      if (mode === 'public') operation.security = [];
      if (mode === 'optional') operation.security = [{ bearer: [] }, {}];
      if (mode === 'authenticated' || mode === 'verified' || mode === 'admin') {
        operation.security = [{ bearer: [] }];
      }
    }
  }
  return document;
}

/** 构建 OpenAPI 文档；既供运行时 Swagger，也供无需连接数据库的离线类型生成。 */
export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('温油站 API')
    .setDescription('温油站共同创作社区后端接口文档 | [前端接入指南](../docs/frontend-guide.md)')
    .setVersion(API_CONTRACT_VERSION)
    .addServer('https://wenyou.site', '公网开发环境')
    .addServer('http://127.0.0.1:3000', '本地开发环境')
    .addBearerAuth()
    .addTag('Auth', '认证 — 注册、登录、Token 刷新、登录终端管理')
    .addTag('Users', '用户 — 资料、关注、拉黑')
    .addTag('Threads', '主题帖 — CRUD、成员管理、私密帖、邀请')
    .addTag('Subthreads', '子贴 — CRUD、排序、发帖权限')
    .addTag('Posts', '楼层 — 发帖、楼中楼、编辑、点赞')
    .addTag('Drafts', '草稿 — 5 槽位草稿池')
    .addTag('Notifications', '通知 — 列表、未读数、已读')
    .addTag('Direct Messages', '私聊 — 一对一会话、消息请求、未读与归档')
    .addTag('Subscriptions', '订阅 — 帖/用户粒度')
    .addTag('Bookmarks', '收藏 — 主题帖收藏')
    .addTag('Media', '媒体 — 预签名上传、缩略图')
    .addTag('Stickers', '表情 — 私有收藏、来源导入、排序与最近使用')
    .addTag('Tags', '标签 — 全局标签搜索/创建')
    .addTag('Search', '搜索 — PostgreSQL ILIKE 全文')
    .addTag('Reports', '举报 — 已搁置')
    .addTag('Health', '健康检查 — 数据库连通')
    .addTag('Admin', '管理后台 — 系统通知、用户搜索')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${lowerFirst(controllerKey.replace(/Controller$/, ''))}${methodKey[0].toUpperCase()}${methodKey.slice(1)}`,
  });
  return applyErrorResponseEnvelope(applySuccessResponseEnvelope(applyAuthSemantics(document)));
}
