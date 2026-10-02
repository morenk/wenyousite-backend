import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { connect, type AddressInfo } from 'node:net';
import fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import { registerAdminCsrfProtection } from '../src/admin/admin-csrf';

// inject 会规范化绝对形式 URL；原始 TCP 才能覆盖路由器和安全 hook 的解释差异。
async function rawRequest(port: number, target: string, headers: Record<string, string> = {}, method = 'POST'): Promise<number> {
  return new Promise((resolve, reject) => {
    let response = '';
    const socket = connect(port, '127.0.0.1', () => {
      const lines = Object.entries(headers).map(([name, value]) => name + ': ' + value + '\r\n').join('');
      socket.write(method + ' ' + target + ' HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nContent-Length: 0\r\n' + lines + 'Connection: close\r\n\r\n');
    });
    socket.setTimeout(2000, () => socket.destroy(new Error('本地原始 HTTP 回归超时')));
    socket.on('data', (chunk: Buffer) => { response += chunk.toString(); });
    socket.on('error', reject);
    socket.on('end', () => resolve(Number(response.split(' ', 2)[1])));
  });
}

describe('实际 Fastify 依赖的管理 CSRF 路由边界', () => {
  let server: FastifyInstance;
  let port: number;
  const write = mock.fn(() => ({ updated: true }));

  beforeEach(async () => {
    write.mock.resetCalls();
    server = fastify();
    await server.register(fastifyCookie);
    await server.register(fastifyCsrf, {
      cookieKey: 'synthetic-csrf',
      getToken: (request) => String(request.headers['x-csrf-token'] ?? ''),
    });
    registerAdminCsrfProtection(server);
    server.route({ method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/v1/admin/fixture', handler: write });
    server.get('/api/v1/admin/session', (_request, reply) => ({ token: reply.generateCsrf() }));
    server.post('/api/v1/admin/auth/challenge', () => ({ challenge: true }));
    server.post('/api/v1/admin/auth/verify', () => ({ verified: true }));
    server.post('/api/v1/admin/auth/challenge/fixture', write);
    server.post('/api/v1/admin/auth/verify-extra', write);
    server.post('/api/v1/public-fixture', () => ({ public: true }));
    await server.listen({ port: 0, host: '127.0.0.1' });
    port = (server.server.address() as AddressInfo).port;
  });

  afterEach(async () => { await server.close(); });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) it(method + ' 对原始及绝对形式管理目标均拒绝缺失 CSRF', async () => {
    for (const target of [
      '/api/v1/admin/fixture', '/api/v1/admin/fixture?query=1',
      'http://127.0.0.1:' + port + '/api/v1/admin/fixture',
      'https://example.invalid/api/v1/admin/fixture?query=1',
    ]) {
      assert.equal(await rawRequest(port, target, {}, method), 403);
    }
    assert.equal(write.mock.callCount(), 0);
  });

  it('错误令牌仍被拒绝，正确令牌在两种请求目标下均正常写入', async () => {
    const session = await server.inject({ url: '/api/v1/admin/session' });
    const cookie = session.cookies.map(({ name, value }) => name + '=' + value).join('; ');
    const token = (session.json() as { token: string }).token;
    const target = 'http://127.0.0.1:' + port + '/api/v1/admin/fixture';
    assert.equal(await rawRequest(port, target, { cookie, 'x-csrf-token': 'invalid' }), 403);
    assert.equal(write.mock.callCount(), 0);
    for (const path of ['/api/v1/admin/fixture', target]) {
      assert.equal(await rawRequest(port, path, { cookie, 'x-csrf-token': token }), 200);
    }
    assert.equal(write.mock.callCount(), 2);
  });

  it('仅既定登录路由豁免；无匹配及编码目标不能到达管理写入 handler', async () => {
    for (const path of ['/api/v1/admin/auth/challenge', '/api/v1/admin/auth/verify', '/api/v1/public-fixture']) {
      assert.equal(await rawRequest(port, path), 200);
      assert.equal(await rawRequest(port, 'http://127.0.0.1:' + port + path), 200);
    }
    for (const path of ['/api/v1/admin/auth/challenge/fixture', '/api/v1/admin/auth/verify-extra']) {
      assert.equal(await rawRequest(port, path), 403);
      assert.equal(await rawRequest(port, 'http://127.0.0.1:' + port + path), 403);
    }
    for (const path of [
      '/api/v1/%61dmin/fixture', '/api/v1/admin//fixture',
      '/api/v1/admin/fixture/', '/api/v1/admin/fixture;%2f', '/api/v1/admin/%',
    ]) {
      assert.ok([400, 403, 404].includes(await rawRequest(port, path)));
    }
    assert.equal(write.mock.callCount(), 0);
  });
});
