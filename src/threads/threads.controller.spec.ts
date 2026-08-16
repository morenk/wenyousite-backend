import { AUTH_MODE_KEY, AuthMode } from '../auth/decorators/auth-mode.constants';
import { ThreadsController } from './threads.controller';

describe('ThreadsController authentication metadata', () => {
  it('主题列表使用可选认证，以便匿名浏览和登录态筛选同时生效', () => {
    const authMode = Reflect.getMetadata(
      AUTH_MODE_KEY,
      ThreadsController.prototype.findAll,
    );
    expect(authMode).toBe(AuthMode.OPTIONAL);
  });
});
