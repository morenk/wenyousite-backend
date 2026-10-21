import type { FastifyInstance } from 'fastify';

export function registerFontSourceParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );
}
