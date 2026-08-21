import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ADMIN_ROLES_KEY, ADMIN_STEP_UP_KEY } from '../admin-auth.constants';
import { forbidden } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';
import { AdminAuthService } from '../admin-auth.service';

/** 管理员权限守卫：角色集合由 AdminAuth/SuperAdminAuth 元数据集中声明。 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminAuth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawToken =
      request.cookies?.['__Secure-wenyou-admin-session'] ??
      request.cookies?.['wenyou-admin-session'];
    const user = await this.adminAuth.validateSession(rawToken);
    request.user = user;
    const allowed = this.reflector.getAllAndOverride<UserRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [UserRole.ADMIN, UserRole.SUPER_ADMIN];
    if (!user?.role || !allowed.includes(user.role)) {
      throw forbidden('需要管理员权限', ErrorCode.ADMIN_REQUIRED);
    }
    const stepUpRequired = this.reflector.getAllAndOverride<boolean>(ADMIN_STEP_UP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (stepUpRequired) this.adminAuth.requireStepUp(user.elevatedUntil);
    return true;
  }
}
