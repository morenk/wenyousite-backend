import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { applySuccessResponseEnvelope } from './success-response-envelope';

/** 构建 OpenAPI 文档；既供运行时 Swagger，也供无需连接数据库的离线类型生成。 */
export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('温油站 API')
    .setDescription('温油站共同创作社区后端接口文档 | [前端接入指南](../docs/frontend-guide.md)')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('Auth', '认证 — 注册、登录、Token 刷新、登录终端管理')
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

  return applySuccessResponseEnvelope(
    SwaggerModule.createDocument(app, config),
  );
}
