import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** 可选 JWT 认证守卫：有 Token 且有效则挂载 req.user，否则放行（不抛异常） */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = await super.canActivate(context);
      return result as boolean;
    } catch {
      // Token 不存在 / 已过期 / 已注销等所有情况均放行
      return true;
    }
  }

  handleRequest(err: any, user: any) {
    return user ?? null;
  }
}
