import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { forbidden } from '../exceptions/business.exception';
import { ErrorCode } from '../exceptions/error-codes';
import { ADMIN_ROLES_KEY } from '../../auth/decorators/admin-auth.constants';

/** 管理员权限守卫：角色集合由 AdminAuth/SuperAdminAuth 元数据集中声明。 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: UserRole } | undefined;
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
