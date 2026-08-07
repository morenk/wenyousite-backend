import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { unauthorized } from '../../common/exceptions/business.exception';

/** 公开路由标记的元数据 key */
export const IS_PUBLIC_KEY = 'isPublic';

/** JWT 认证守卫：默认所有路由需要认证，使用 @Public() 装饰器标记公开路由 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // 检查路由是否通过 @Public() 标记为公开
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

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
