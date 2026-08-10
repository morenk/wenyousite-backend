import 'fastify';

/** Passport 写入 FastifyRequest 的认证主体；控制器可在迁移到 @CurrentUser 前安全取用。 */
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email?: string;
      username?: string;
      role?: string;
      emailVerified?: boolean;
      sessionId?: string;
      adminSessionId?: string;
      elevatedUntil?: string;
    };
  }
}
