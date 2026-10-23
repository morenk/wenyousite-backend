import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { CanActivate, ExecutionContext, ValidationPipe } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { AdminTextFontsController } from '../admin/admin-text-fonts.controller';
import { AdminGuard } from '../admin/guards/admin.guard';
import { FontAdminService } from './font-admin.service';
import { FontQueryService } from './font-query.service';
import { registerFontSourceParser } from './font-upload';
import { FONT_SOURCE_MAX_BYTES } from './font-protocol';

const sourcePath =
  '/api/v1/admin/text-fonts/tff_' + 'a'.repeat(32) + '/sources?format=ttf&expectedFamilyRevision=1';
let app: NestFastifyApplication;
const upload = jest.fn(async (_familyId: string, _query: unknown, bytes: Buffer) => ({
  bytes: bytes.length,
}));
const adminIdentity: CanActivate = {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest<FastifyRequest & { user: { id: string } }>().user = {
      id: 'unit-admin',
    };
    return true;
  },
};
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [AdminTextFontsController],
    providers: [
      { provide: FontAdminService, useValue: { upload } },
      { provide: FontQueryService, useValue: {} },
    ],
  })
    .overrideGuard(AdminGuard)
    .useValue(adminIdentity)
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  const fastify = app.getHttpAdapter().getInstance();
  registerFontSourceParser(fastify);
  fastify.post('/unrelated-binary', async () => ({ accepted: true }));
  await app.init();
  await fastify.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => upload.mockClear());

it.each([
  ['GET', '/management', undefined],
  ['POST', '/submissions', { submissionId: 'f48fc025-1ff4-48b5-b6c2-fc9ae6517f79', name: '字体' }],
  ['GET', '/submissions/f48fc025-1ff4-48b5-b6c2-fc9ae6517f79', undefined],
  [
    'POST',
    '/submissions/f48fc025-1ff4-48b5-b6c2-fc9ae6517f79/process',
    { requestId: 'f48fc025-1ff4-48b5-b6c2-fc9ae6517f79' },
  ],
  ['PUT', '/order', { expectedCatalogRevision: 0, groups: [{ language: 'zh', items: [] }] }],
] as const)('契约先行的 %s %s 失败关闭，不误入旧家族路由', async (method, path, payload) => {
  const result = await app.inject({ method, url: '/api/v1/admin/text-fonts' + path, payload });
  expect(result.statusCode).toBe(503);
  expect(upload).not.toHaveBeenCalled();
});

it('契约先行的 submissionId 上传不会降级为非幂等旧上传', async () => {
  const result = await app.inject({
    method: 'POST',
    url: sourcePath + '&submissionId=f48fc025-1ff4-48b5-b6c2-fc9ae6517f79',
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.alloc(4),
  });
  expect(result.statusCode).toBe(503);
  expect(upload).not.toHaveBeenCalled();
});

it.each([1048577, 11 * 1024 * 1024, FONT_SOURCE_MAX_BYTES])(
  '真实 Controller 接受 %i 字节原件且 DTO 保持原始 Buffer',
  async (size) => {
    const result = await app.inject({
      method: 'POST',
      url: sourcePath,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(size),
    });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual({ bytes: size });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1]).toMatchObject({ format: 'ttf', expectedFamilyRevision: 1 });
  },
);
it('64 MiB + 1 在进入业务服务前返回 413', async () => {
  const result = await app.inject({
    method: 'POST',
    url: sourcePath,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.alloc(FONT_SOURCE_MAX_BYTES + 1),
  });
  expect(result.statusCode).toBe(413);
  expect(upload).not.toHaveBeenCalled();
});
it('没有 Content-Length 的分块正文也不能越过 64 MiB', async () => {
  const chunk = Buffer.alloc(1024 * 1024);
  async function* body() {
    for (let index = 0; index < 65; index++) yield chunk;
  }
  const result = await app.inject({
    method: 'POST',
    url: sourcePath,
    headers: { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
    payload: Readable.from(body()),
  });
  expect(result.statusCode).toBe(413);
  expect(upload).not.toHaveBeenCalled();
});
it('其他二进制接口保留 Fastify 默认 1 MiB 限制', async () => {
  const result = await app.inject({
    method: 'POST',
    url: '/unrelated-binary',
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.alloc(1048577),
  });
  expect(result.statusCode).toBe(413);
  expect(upload).not.toHaveBeenCalled();
});
