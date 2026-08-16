import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_MODE_KEY, AuthMode } from '../decorators/auth-mode.constants';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * 统一解释路由认证模式。缺少声明时按受保护路由处理，避免新增接口意外公开。
 */
@Injectable()
export class GlobalAuthGuard extends JwtAuthGuard {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const mode = this.reflector.getAllAndOverride<AuthMode>(AUTH_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (mode === AuthMode.PUBLIC || mode === AuthMode.ADMIN || mode === AuthMode.APPEAL) {
      return true;
    }

    if (mode === AuthMode.OPTIONAL) {
      const request = context
        .switchToHttp()
        .getRequest<{ headers?: { authorization?: string } }>();
      if (!request.headers?.authorization) return true;
    }

    return super.canActivate(context);
  }
}
