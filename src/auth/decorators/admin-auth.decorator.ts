import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiExtension, ApiHeader } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { AdminBearerGuard } from '../../admin/guards/admin-bearer.guard';
import { Auth } from './auth.decorator';
import { ADMIN_ROLES_KEY } from './admin-auth.constants';
import { ADMIN_STEP_UP_KEY } from '../../admin/admin-auth.constants';
import { AUTH_MODE_KEY, AuthMode } from './auth-mode.constants';

export { ADMIN_ROLES_KEY } from './admin-auth.constants';

/** 独立管理员 Cookie 会话 + 指定管理员角色。 */
export function AdminAuth(...roles: UserRole[]) {
  const allowedRoles = roles.length > 0 ? roles : [UserRole.ADMIN, UserRole.SUPER_ADMIN];
  return applyDecorators(
    SetMetadata(AUTH_MODE_KEY, AuthMode.ADMIN),
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

/** 前台/移动端管理员能力：普通 Bearer 登录态 + 实时角色校验，不要求站务会话。 */
export function AdminBearerAuth(...roles: UserRole[]) {
  const allowedRoles = roles.length > 0 ? roles : [UserRole.ADMIN, UserRole.SUPER_ADMIN];
  return applyDecorators(
    Auth(),
    SetMetadata(ADMIN_ROLES_KEY, allowedRoles),
    UseGuards(AdminBearerGuard),
  );
}
