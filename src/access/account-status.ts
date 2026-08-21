import { Prisma, UserSanctionType } from '@prisma/client';
import { ErrorCode } from '../common/exceptions/error-codes';

export interface ActiveSanctionRecord {
  type: UserSanctionType;
  endsAt: Date | null;
}

/** 所有认证、资料和治理查询共用的“当前有效处罚”定义。 */
export function activeSanctionWhere(now = new Date()): Prisma.UserSanctionWhereInput {
  return {
    revokedAt: null,
    startsAt: { lte: now },
    OR: [
      { type: UserSanctionType.BAN },
      { type: UserSanctionType.SUSPENSION, endsAt: { gt: now } },
    ],
  };
}

export function sanctionFailure(sanction?: ActiveSanctionRecord | null) {
  if (!sanction) return null;
  if (sanction.type === UserSanctionType.BAN) {
    return { message: '账号已被封禁', code: ErrorCode.ACCOUNT_BANNED };
  }
  return {
    message: sanction.endsAt ? `账号已被暂停至 ${sanction.endsAt.toISOString()}` : '账号已被暂停',
    code: ErrorCode.ACCOUNT_SUSPENDED,
  };
}
