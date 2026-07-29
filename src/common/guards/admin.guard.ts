import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/** 管理员权限守卫：要求用户角色为 ADMIN 或 SUPER_ADMIN */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      throw new ForbiddenException('需要管理员权限');
    }
    return true;
  }
}
