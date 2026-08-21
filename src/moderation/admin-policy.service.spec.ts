import { UserRole } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { AdminPolicyService } from './admin-policy.service';

describe('AdminPolicyService', () => {
  const policy = new AdminPolicyService();

  it('ADMIN 只能处罚普通用户', () => {
    const actor = { id: 'admin-1', role: UserRole.ADMIN } as const;
    expect(() =>
      policy.assertCanSanction(actor, { id: 'user-1', role: UserRole.USER }),
    ).not.toThrow();
    expect(() => policy.assertCanSanction(actor, { id: 'admin-2', role: UserRole.ADMIN })).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.CANNOT_MODERATE_ADMIN }),
    );
  });

  it('SUPER_ADMIN 可处罚 ADMIN，但不能处罚自己或其他超级管理员', () => {
    const actor = { id: 'root-1', role: UserRole.SUPER_ADMIN } as const;
    expect(() =>
      policy.assertCanSanction(actor, { id: 'admin-1', role: UserRole.ADMIN }),
    ).not.toThrow();
    expect(() =>
      policy.assertCanSanction(actor, { id: 'root-1', role: UserRole.SUPER_ADMIN }),
    ).toThrow();
    expect(() =>
      policy.assertCanSanction(actor, { id: 'root-2', role: UserRole.SUPER_ADMIN }),
    ).toThrow();
  });

  it('只有超级管理员可以授予或撤销 ADMIN', () => {
    expect(() =>
      policy.assertCanManageRole(
        { id: 'admin-1', role: UserRole.ADMIN },
        { id: 'user-1', role: UserRole.USER },
      ),
    ).toThrow(expect.objectContaining({ errorCode: ErrorCode.ADMIN_REQUIRED }));
    expect(() =>
      policy.assertCanManageRole(
        { id: 'root-1', role: UserRole.SUPER_ADMIN },
        { id: 'user-1', role: UserRole.USER },
      ),
    ).not.toThrow();
  });

  it('能力列表由角色固定派生', () => {
    expect(policy.capabilities(UserRole.ADMIN)).toContain('REPORT_RESOLVE');
    expect(policy.capabilities(UserRole.ADMIN)).not.toContain('ADMIN_ROLE_MANAGE');
    expect(policy.capabilities(UserRole.SUPER_ADMIN)).toContain('ADMIN_ROLE_MANAGE');
  });
});
