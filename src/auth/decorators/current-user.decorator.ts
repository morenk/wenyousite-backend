import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** JWT strategy 挂载到请求上的最小用户上下文。 */
export interface CurrentUserPayload {
  id: string;
  username?: string;
  role?: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
  sessionId?: string;
  adminSessionId?: string;
  elevatedUntil?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserPayload | undefined =>
    context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>().user,
);
