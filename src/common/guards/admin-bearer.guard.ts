import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ADMIN_ROLES_KEY } from '../../auth/decorators/admin-auth.constants';
import { forbidden } from '../exceptions/business.exception';
import { ErrorCode } from '../exceptions/error-codes';

/** 前台与移动端管理员守卫：复用普通 Bearer 登录态，不要求独立站务会话。 */
@Injectable()
export class AdminBearerGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: { role?: UserRole } }>().user;
    const allowed = this.reflector.getAllAndOverride<UserRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [UserRole.ADMIN, UserRole.SUPER_ADMIN];
    if (!user?.role || !allowed.includes(user.role)) {
      throw forbidden('需要管理员权限', ErrorCode.ADMIN_REQUIRED);
    }
    return true;
  }
}
