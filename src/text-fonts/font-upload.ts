import type { FastifyInstance } from 'fastify';
import { FONT_SOURCE_MAX_BYTES } from './font-protocol';

declare module 'fastify' {
  interface FastifyContextConfig {
    textFontSourceUpload?: boolean;
  }
}

export const FONT_SOURCE_ROUTE_CONFIG = { textFontSourceUpload: true } as const;

export function registerFontSourceParser(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    // Nest 的 RouteConfig 只设置 config；Fastify 的实际限额属于顶层路由选项。
    if (route.config?.textFontSourceUpload === true && route.method === 'POST')
      route.bodyLimit = FONT_SOURCE_MAX_BYTES;
  });
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );
}
