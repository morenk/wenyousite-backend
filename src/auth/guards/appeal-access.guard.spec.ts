import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppealAccessService } from '../appeal-access.service';
import { AppealAccessGuard } from './appeal-access.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

function context(authorization?: string) {
  const request = { headers: authorization ? { authorization } : {}, user: undefined as unknown };
  return {
    request,
    execution: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext,
  };
}

describe('AppealAccessGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('申诉凭据经专用服务认证并写入请求主体', async () => {
    const appealAccess = {
      isAppealToken: jest.fn().mockReturnValue(true),
      authenticate: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    const guard = new AppealAccessGuard(
      new Reflector(),
      appealAccess as unknown as AppealAccessService,
    );
    const testContext = context('Bearer appeal-token');

    await expect(guard.canActivate(testContext.execution)).resolves.toBe(true);
    expect(appealAccess.authenticate).toHaveBeenCalledWith('appeal-token');
    expect(testContext.request.user).toEqual({ id: 'user-1' });
  });

  it('普通 access token 继续走标准 JWT 守卫，保留处罚检查', () => {
    const appealAccess = {
      isAppealToken: jest.fn().mockReturnValue(false),
      authenticate: jest.fn(),
    };
    const standardGuard = jest.spyOn(JwtAuthGuard.prototype, 'canActivate').mockReturnValue(true);
    const guard = new AppealAccessGuard(
      new Reflector(),
      appealAccess as unknown as AppealAccessService,
    );
    const testContext = context('Bearer access-token');

    expect(guard.canActivate(testContext.execution)).toBe(true);
    expect(standardGuard).toHaveBeenCalledWith(testContext.execution);
    expect(appealAccess.authenticate).not.toHaveBeenCalled();
  });
});
