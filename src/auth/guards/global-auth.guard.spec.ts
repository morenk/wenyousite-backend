import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_MODE_KEY, AuthMode } from '../decorators/auth-mode.constants';
import { GlobalAuthGuard } from './global-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

function context(authorization?: string) {
  const request = { headers: authorization ? { authorization } : {} };
  return {
    request,
    execution: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext,
  };
}

describe('GlobalAuthGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([AuthMode.PUBLIC, AuthMode.ADMIN, AuthMode.APPEAL])(
    '%s 交由公开或专用认证链路处理',
    (mode) => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(mode),
      } as unknown as Reflector;
      const standardGuard = jest.spyOn(JwtAuthGuard.prototype, 'canActivate');

      expect(new GlobalAuthGuard(reflector).canActivate(context().execution)).toBe(true);
      expect(standardGuard).not.toHaveBeenCalled();
    },
  );

  it('Optional 无凭据匿名放行，有凭据时必须校验', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(AuthMode.OPTIONAL),
    } as unknown as Reflector;
    const standardGuard = jest
      .spyOn(JwtAuthGuard.prototype, 'canActivate')
      .mockReturnValue(true);
    const guard = new GlobalAuthGuard(reflector);

    expect(guard.canActivate(context().execution)).toBe(true);
    expect(standardGuard).not.toHaveBeenCalled();
    expect(guard.canActivate(context('Bearer valid').execution)).toBe(true);
    expect(standardGuard).toHaveBeenCalledTimes(1);
  });

  it.each([AuthMode.READ, AuthMode.WRITE, undefined])(
    '%s 使用标准 JWT，缺少元数据也默认拒绝匿名访问',
    (mode) => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(mode),
      } as unknown as Reflector;
      const standardGuard = jest
        .spyOn(JwtAuthGuard.prototype, 'canActivate')
        .mockReturnValue(true);
      const testContext = context();

      expect(new GlobalAuthGuard(reflector).canActivate(testContext.execution)).toBe(true);
      expect(standardGuard).toHaveBeenCalledWith(testContext.execution);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(AUTH_MODE_KEY, expect.any(Array));
    },
  );
});
