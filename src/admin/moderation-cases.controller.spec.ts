import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AppealAccessGuard } from '../auth/guards/appeal-access.guard';
import { IS_PUBLIC_KEY } from '../auth/guards/jwt-auth.guard';
import { UserModerationAppealsController } from './moderation-cases.controller';

describe('UserModerationAppealsController auth contract', () => {
  it.each(['mine', 'appeal'] as const)('%s 同时接受标准会话和申诉专用凭据', (name) => {
    const method = UserModerationAppealsController.prototype[name];
    const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];

    expect(guards).toEqual([AppealAccessGuard]);
  });

  it('申诉凭据签发入口保持公开，由账号密码和限流保护', () => {
    const method = UserModerationAppealsController.prototype.issueToken;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, method)).toBe(true);
  });
});
