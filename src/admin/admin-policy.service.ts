import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { forbidden } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

export const ADMIN_CAPABILITIES = {
  [UserRole.ADMIN]: [
    'REPORT_READ',
    'REPORT_RESOLVE',
    'CONTENT_MODERATE',
    'USER_SANCTION',
    'SYSTEM_NOTIFICATION',
    'TAXONOMY_MANAGE',
  ],
  [UserRole.SUPER_ADMIN]: [
    'REPORT_READ',
    'REPORT_RESOLVE',
    'CONTENT_MODERATE',
    'USER_SANCTION',
    'SYSTEM_NOTIFICATION',
    'ADMIN_ROLE_MANAGE',
    'ADMIN_SANCTION',
    'TAXONOMY_MANAGE',
  ],
} as const;

export type AdminRole = typeof UserRole.ADMIN | typeof UserRole.SUPER_ADMIN;

export interface AdminActor {
  id: string;
  username?: string;
  role: AdminRole;
}

@Injectable()
export class AdminPolicyService {
  capabilities(role: AdminRole) {
    return ADMIN_CAPABILITIES[role];
  }

  assertCanSanction(actor: AdminActor, target: { id: string; role: UserRole }) {
    if (actor.id === target.id) {
      throw forbidden('不能处罚自己的账号', ErrorCode.CANNOT_MODERATE_ADMIN);
    }
    if (target.role === UserRole.SUPER_ADMIN) {
      throw forbidden('不能处罚超级管理员', ErrorCode.CANNOT_MODERATE_ADMIN);
    }
    if (actor.role === UserRole.ADMIN && target.role !== UserRole.USER) {
      throw forbidden('普通管理员不能处罚管理员', ErrorCode.CANNOT_MODERATE_ADMIN);
    }
  }

  assertCanManageRole(actor: AdminActor, target: { id: string; role: UserRole }) {
    if (actor.role !== UserRole.SUPER_ADMIN) {
      throw forbidden('仅超级管理员可以调整管理员角色', ErrorCode.ADMIN_REQUIRED);
    }
    if (actor.id === target.id || target.role === UserRole.SUPER_ADMIN) {
      throw forbidden('不能调整超级管理员角色', ErrorCode.CANNOT_MODERATE_ADMIN);
    }
  }
}
