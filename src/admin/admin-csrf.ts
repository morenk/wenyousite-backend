import type { FastifyInstance } from 'fastify';
import type {} from '@fastify/csrf-protection';

const publicAdminAuth = new Set(['/api/v1/admin/auth/challenge', '/api/v1/admin/auth/verify']);

export function registerAdminCsrfProtection(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', (request, reply, done) => {
    // 使用已匹配路由，避免绝对形式等请求目标与路由器解释不一致而跳过 CSRF。
    const path = request.routeOptions.url;
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    if (!mutating || !path?.startsWith('/api/v1/admin/') || publicAdminAuth.has(path)) {
      done();
      return;
    }
    fastify.csrfProtection(request, reply, done);
  });
}
