/** 认证控制器契约测试：会话接口使用独立限流，避免批量撤销被登录接口配额影响 */

import 'reflect-metadata';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController 会话限流', () => {
  it('登录终端列表和远程退出各自允许每分钟 60 次请求', () => {
    const listSessions = AuthController.prototype.listSessions;
    const revokeSession = AuthController.prototype.revokeSession;

    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', listSessions)).toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', listSessions)).toBe(60000);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', revokeSession)).toBe(60);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', revokeSession)).toBe(60000);
  });

  it('登录终端列表使用 access token 中的稳定终端 ID 标记当前项', async () => {
    const authService = {
      listSessions: jest.fn().mockResolvedValue([]),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const request = {
      user: { id: 'u1', sessionId: 'family-1' },
      cookies: { refreshToken: 'legacy-cookie' },
    } as unknown as FastifyRequest;

    await controller.listSessions(request);

    expect(authService.listSessions).toHaveBeenCalledWith(
      'u1',
      'family-1',
      'legacy-cookie',
    );
  });
});

describe('AuthController 客户端平台契约', () => {
  const makeReply = () => ({ setCookie: jest.fn() }) as unknown as FastifyReply;

  it('登录缺失或非法平台时按 web 创建会话，并设置 7 天 Cookie', async () => {
    const authService = {
      login: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', user: {} }),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const reply = makeReply();
    const request = { headers: { 'x-client-platform': 'desktop', 'user-agent': 'browser' } } as unknown as FastifyRequest;

    const result = await controller.login({ account: 'user', password: 'password' }, request, reply);

    expect(authService.login).toHaveBeenCalledWith(
      { account: 'user', password: 'password' },
      'browser',
      'web',
    );
    expect(reply.setCookie).toHaveBeenCalledWith(
      'refreshToken',
      'refresh',
      expect.objectContaining({ maxAge: 7 * 24 * 60 * 60 }),
    );
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('移动客户端登录从响应体取得 refresh token，且不设置浏览器 Cookie', async () => {
    const authService = {
      login: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', user: {} }),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const reply = makeReply();
    const request = {
      headers: { 'x-client-platform': 'mobile', 'user-agent': 'flutter-app' },
    } as unknown as FastifyRequest;

    const result = await controller.login({ account: 'user', password: 'password' }, request, reply);

    expect(result).toHaveProperty('refreshToken', 'refresh');
    expect(reply.setCookie).not.toHaveBeenCalled();
  });

  it('移动客户端刷新依据服务端会话平台返回 token，不信任请求头', async () => {
    const authService = {
      refresh: jest.fn().mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        platform: 'mobile',
        user: {},
      }),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const reply = makeReply();
    const request = {
      headers: { 'x-client-platform': 'web' },
      cookies: { refreshToken: 'old-refresh' },
    } as unknown as FastifyRequest;

    const result = await controller.refresh({ refreshToken: undefined }, request, reply);

    expect(authService.refresh).toHaveBeenCalledWith('old-refresh');
    expect(reply.setCookie).not.toHaveBeenCalled();
    expect(result).toHaveProperty('refreshToken', 'new-refresh');
    expect(result).not.toHaveProperty('platform');
  });

  it('Web 刷新只通过 httpOnly Cookie 返回 refresh token', async () => {
    const authService = {
      refresh: jest.fn().mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        platform: 'web',
        user: {},
      }),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const reply = makeReply();
    const request = {
      headers: {},
      cookies: { refreshToken: 'old-refresh' },
    } as unknown as FastifyRequest;

    const result = await controller.refresh({ refreshToken: undefined }, request, reply);

    expect(reply.setCookie).toHaveBeenCalledWith(
      'refreshToken',
      'new-refresh',
      expect.objectContaining({ maxAge: 7 * 24 * 60 * 60 }),
    );
    expect(result).not.toHaveProperty('refreshToken');
  });
});
