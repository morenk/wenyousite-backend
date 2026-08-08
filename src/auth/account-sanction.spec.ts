import { UserSanctionType } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';
import { sanctionFailure } from './account-sanction';

describe('账号处罚认证判定', () => {
  it('永久封禁返回稳定错误码', () => {
    expect(sanctionFailure({ type: UserSanctionType.BAN, endsAt: null })).toEqual({
      message: '账号已被封禁',
      code: ErrorCode.ACCOUNT_BANNED,
    });
  });

  it('暂停包含明确结束时间', () => {
    const endsAt = new Date('2027-01-01T00:00:00.000Z');
    expect(sanctionFailure({ type: UserSanctionType.SUSPENSION, endsAt })).toEqual({
      message: `账号已被暂停至 ${endsAt.toISOString()}`,
      code: ErrorCode.ACCOUNT_SUSPENDED,
    });
  });

  it('没有有效处罚时允许认证', () => {
    expect(sanctionFailure(null)).toBeNull();
  });
});
