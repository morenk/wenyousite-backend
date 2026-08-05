/** 认证控制器契约测试：会话接口使用独立限流，避免批量撤销被登录接口配额影响 */

import 'reflect-metadata';
import { AuthController } from './auth.controller';

describe('AuthController 会话限流', () => {
  it('会话列表和远程撤销各自允许每分钟 60 次请求', () => {
    const listSessions = AuthController.prototype.listSessions;
    const revokeSession = AuthController.prototype.revokeSession;

    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', listSessions)).toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', listSessions)).toBe(60000);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', revokeSession)).toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', revokeSession)).toBe(60000);
  });
});
