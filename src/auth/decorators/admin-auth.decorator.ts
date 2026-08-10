import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiExtension, ApiHeader } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ADMIN_ROLES_KEY } from './admin-auth.constants';
import { ADMIN_STEP_UP_KEY } from '../../admin/admin-auth.constants';

export { ADMIN_ROLES_KEY } from './admin-auth.constants';

/** 独立管理员 Cookie 会话 + 指定管理员角色。 */
export function AdminAuth(...roles: UserRole[]) {
  const allowedRoles = roles.length > 0 ? roles : [UserRole.ADMIN, UserRole.SUPER_ADMIN];
  return applyDecorators(
    ApiExtension('x-auth-mode', 'admin'),
    ApiCookieAuth('adminSession'),
    ApiHeader({ name: 'X-CSRF-Token', required: false, description: '管理后台写操作必填' }),
    SetMetadata(ADMIN_ROLES_KEY, allowedRoles),
    UseGuards(AdminGuard),
  );
}

/** 仅超级管理员可访问。 */
export function SuperAdminAuth() {
  return AdminAuth(UserRole.SUPER_ADMIN);
}

/** 需要近期邮箱二次确认的高风险管理员操作。 */
export function AdminStepUpAuth(...roles: UserRole[]) {
  return applyDecorators(AdminAuth(...roles), SetMetadata(ADMIN_STEP_UP_KEY, true));
}

export function SuperAdminStepUpAuth() {
  return AdminStepUpAuth(UserRole.SUPER_ADMIN);
}
