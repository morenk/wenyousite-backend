import { Controller, Get, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastify from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

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

@Controller('protected-fixture')
class ProtectedFixtureController {
  @Get()
  get() { return { protected: true }; }
}

@Module({ controllers: [ProtectedFixtureController] })
class MiddlewareFixtureModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((_request: IncomingMessage, response: ServerResponse) => {
      response.statusCode = 401;
      response.end();
    }).forRoutes({ path: 'protected-fixture', method: RequestMethod.GET });
  }
}

describe('实际 Nest/Fastify 适配器的鉴权与请求拒绝路径', () => {
  it('绝对形式请求不能绕过 Nest 路径中间件', async () => {
    const module = await Test.createTestingModule({ imports: [MiddlewareFixtureModule] }).compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    try {
      await app.listen(0, '127.0.0.1');
      const port = (app.getHttpServer().address() as AddressInfo).port;
      for (const target of ['/protected-fixture', 'http://127.0.0.1:' + port + '/protected-fixture']) {
        expect(await rawRequest(port, target, {}, 'GET')).toBe(401);
      }
    } finally {
      await app.close();
    }
  });

  it('非法 URL 不能进入另一前缀的受保护 fallback', async () => {
    const server = fastify();
    const privateFallback = jest.fn(() => ({ private: true }));
    try {
      await server.register(async (scope) => {
        scope.get('/known', () => ({ public: true }));
        scope.setNotFoundHandler((_request, reply) => reply.code(404).send());
      }, { prefix: '/public' });
      await server.register(async (scope) => {
        scope.setNotFoundHandler({
          preHandler: (_request, reply, done) => { reply.code(401).send(); done(); },
        }, privateFallback);
      }, { prefix: '/private' });
      const response = await server.inject({ method: 'POST', url: '/public/%' });
      expect(response.statusCode).toBe(400);
      expect(privateFallback).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('false schema 与混合大小写 header schema 都不能跳过校验', async () => {
    const server = fastify();
    const handler = jest.fn(() => ({ accepted: true }));
    try {
      server.post('/reject-body', { schema: { body: false } }, handler);
      server.post('/reject-header', {
        schema: { headers: { type: 'object', properties: { 'X-Required': { type: 'string', const: 'expected' } }, required: ['X-Required'] } },
      }, handler);
      expect((await server.inject({ method: 'POST', url: '/reject-body', payload: { value: true } })).statusCode).toBe(400);
      expect((await server.inject({ method: 'POST', url: '/reject-header', headers: { 'x-required': 'wrong' } })).statusCode).toBe(400);
      expect(handler).not.toHaveBeenCalled();
      expect((await server.inject({ method: 'POST', url: '/reject-header', headers: { 'x-required': 'expected' } })).statusCode).toBe(200);
    } finally {
      await server.close();
    }
  });
});
