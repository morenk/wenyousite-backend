import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { unauthorized } from '../../common/exceptions/business.exception';

/** 只负责校验 Bearer JWT；路由认证模式由 GlobalAuthGuard 统一解释。 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false | null | undefined,
    info: { name?: unknown } | null | undefined,
    context: ExecutionContext,
  ): TUser {
    if (err) throw err;
    if (user) return user;
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string } }>();
    if (!request.headers?.authorization) {
      throw unauthorized('请先登录', ErrorCode.UNAUTHORIZED);
    }
    if (info?.name === 'TokenExpiredError') {
      throw unauthorized('访问令牌已过期', ErrorCode.TOKEN_EXPIRED);
    }
    throw unauthorized('访问令牌无效', ErrorCode.TOKEN_INVALID);
  }
}
