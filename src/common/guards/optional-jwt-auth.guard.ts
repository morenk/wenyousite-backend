import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ErrorCode } from '../exceptions/error-codes';
import { unauthorized } from '../exceptions/business.exception';

/** 可选 JWT：未携带凭据时匿名放行，主动携带的无效凭据必须返回稳定 401。 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string } }>();
    if (!request.headers?.authorization) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false | null | undefined,
    info?: { name?: unknown },
  ): TUser {
    if (err) throw err;
    if (user) return user;
    if (info?.name === 'TokenExpiredError') {
      throw unauthorized('访问令牌已过期', ErrorCode.TOKEN_EXPIRED);
    }
    throw unauthorized('访问令牌无效', ErrorCode.TOKEN_INVALID);
  }
}
