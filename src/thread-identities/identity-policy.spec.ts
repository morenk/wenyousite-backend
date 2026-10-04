import {
  canonicalMentions,
  assertIdentityToken,
  eligibleIdentity,
  identityToken,
} from './identity-policy';
import { ErrorCode } from '../common/exceptions/error-codes';
describe('帖内身份发言与提及策略', () => {
  it('楼主本人、协作者和玩家有资格，普通参与者没有', () => {
    expect(eligibleIdentity('owner', 'owner', null)).toBe(true);
    expect(eligibleIdentity('owner', 'collab', { role: 'COLLABORATOR', playerMarked: false })).toBe(
      true,
    );
    expect(eligibleIdentity('owner', 'player', { role: 'PARTICIPANT', playerMarked: true })).toBe(
      true,
    );
    expect(eligibleIdentity('owner', 'reader', { role: 'PARTICIPANT', playerMarked: false })).toBe(
      false,
    );
  });
  it('旧客户端仅账号模式兼容，RP有效必须确认且任何已确认状态变化冲突', () => {
    expect(() => assertIdentityToken(undefined, 'a', false)).not.toThrow();
    expect(() => assertIdentityToken(undefined, 'a', true)).toThrow();
    expect(() => assertIdentityToken('a', 'b', false)).toThrow();
    try {
      assertIdentityToken('a', 'b', true);
    } catch (e) {
      expect((e as { errorCode: number }).errorCode).toBe(ErrorCode.RP_IDENTITY_CHANGED);
    }
    expect(() => assertIdentityToken('a', 'a', true)).not.toThrow();
    expect(identityToken(['thread', 'a'])).not.toBe(identityToken(['other', 'a']));
  });
  it('同账号多种标签分别保留，支持空格和标点，代码和转义不触发身份语义', () => {
    const body =
      '[@白 鸦！](/users/u1) [@夜渡](/users/u1) `[@代码](/users/u2)` \\[@转义](/users/u3)';
    expect(canonicalMentions(body)).toEqual([
      { userId: 'u1', label: '白 鸦！' },
      { userId: 'u1', label: '夜渡' },
    ]);
  });
});
