import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiExtension, ApiHeader } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth } from '../auth/decorators/auth.decorator';
import { AUTH_MODE_KEY, AuthMode } from '../auth/decorators/auth-mode.constants';
import { ADMIN_ROLES_KEY, ADMIN_STEP_UP_KEY } from './admin-auth.constants';
import { AdminBearerGuard } from './guards/admin-bearer.guard';
import { AdminGuard } from './guards/admin.guard';

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

export function SuperAdminAuth() {
  return AdminAuth(UserRole.SUPER_ADMIN);
}

export function AdminStepUpAuth(...roles: UserRole[]) {
  return applyDecorators(AdminAuth(...roles), SetMetadata(ADMIN_STEP_UP_KEY, true));
}

export function SuperAdminStepUpAuth() {
  return AdminStepUpAuth(UserRole.SUPER_ADMIN);
}

/** 普通 Bearer 登录态中的管理员能力，不要求独立站务会话。 */
export function AdminBearerAuth(...roles: UserRole[]) {
  const allowedRoles = roles.length > 0 ? roles : [UserRole.ADMIN, UserRole.SUPER_ADMIN];
  return applyDecorators(
    Auth(),
    SetMetadata(ADMIN_ROLES_KEY, allowedRoles),
    UseGuards(AdminBearerGuard),
  );
}
