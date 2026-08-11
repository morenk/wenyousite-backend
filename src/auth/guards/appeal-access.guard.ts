import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppealAccessService } from '../appeal-access.service';
import { JwtAuthGuard } from './jwt-auth.guard';

function bearerToken(authorization?: string): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/** 普通有效会话或申诉专用凭据均可通过；专用凭据不会被其他 Guard 接受。 */
@Injectable()
export class AppealAccessGuard extends JwtAuthGuard {
  constructor(
    reflector: Reflector,
    private readonly appealAccess: AppealAccessService,
  ) {
    super(reflector);
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
      user?: unknown;
    }>();
    const token = bearerToken(request.headers?.authorization);
    if (!token || !this.appealAccess.isAppealToken(token)) {
      return super.canActivate(context);
    }
    return this.appealAccess.authenticate(token).then((user) => {
      request.user = user;
      return true;
    });
  }
}
