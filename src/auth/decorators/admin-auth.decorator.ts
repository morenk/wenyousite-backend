import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminGuard } from '../../common/guards/admin.guard';
import { Auth } from './auth.decorator';
import { ADMIN_ROLES_KEY } from './admin-auth.constants';

export { ADMIN_ROLES_KEY } from './admin-auth.constants';

/** JWT + 已验证邮箱 + 指定管理员角色。 */
export function AdminAuth(...roles: UserRole[]) {
  const allowedRoles = roles.length > 0 ? roles : [UserRole.ADMIN, UserRole.SUPER_ADMIN];
  return applyDecorators(
    // ApiExtension 对同名键保留首次写入值，必须先于 Auth() 声明管理员语义。
    ApiExtension('x-auth-mode', 'admin'),
    Auth(),
    SetMetadata(ADMIN_ROLES_KEY, allowedRoles),
    UseGuards(AdminGuard),
  );
}

/** 仅超级管理员可访问。 */
export function SuperAdminAuth() {
  return AdminAuth(UserRole.SUPER_ADMIN);
}
