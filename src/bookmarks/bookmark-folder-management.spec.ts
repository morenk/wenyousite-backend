import { Prisma } from '@prisma/client';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';
import { MomentsController } from '../moments/moments.controller';
import { MomentsService } from '../moments/moments.service';
import { MomentBookmarksService } from '../moments/moment-bookmarks.service';
import { MomentCommentsService } from '../moments/moment-comments.service';
import { MomentAccessService } from '../moments/moment-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalAuthGuard } from '../auth/guards/global-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AUTH_MODE_KEY, AuthMode } from '../auth/decorators/auth-mode.constants';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../common/interceptors/response.interceptor';

const folder = {
  id: 'custom',
  userId: 'owner',
  name: '原名',
  isDefault: false,
  createdAt: new Date('2026-09-12T00:00:00Z'),
};
const catalog = () => ({
  findFirst: jest.fn().mockResolvedValue(folder),
  findUnique: jest.fn().mockResolvedValue({ _count: { bookmarks: 2 } }),
  upsert: jest.fn().mockResolvedValue({ id: 'default', isDefault: true }),
  update: jest.fn().mockImplementation(({ data }: { data: { name: string } }) => ({
    ...folder,
    ...data,
    _count: { bookmarks: 3 },
  })),
  delete: jest.fn().mockResolvedValue(folder),
});

// 真实 HTTP 路由、JWT Guard/策略、DTO、Service、响应层；数据库行为另由隔离集成覆盖。
describe.each([
  {
    kind: '主题帖',
    path: '/bookmarks/folders',
    model: 'bookmarkFolder' as const,
    records: 'userBookmark' as const,
    controller: BookmarksController,
    rename: 'renameFolder',
    remove: 'deleteFolder',
    prefix: 'bookmarks',
    response: 'BookmarkFolderResponseDto',
  },
  {
    kind: '动态',
    path: '/moments/bookmark-folders',
    model: 'momentBookmarkFolder' as const,
    records: 'momentBookmark' as const,
    controller: MomentsController,
    rename: 'renameBookmarkFolder',
    remove: 'deleteBookmarkFolder',
    prefix: 'moments',
    response: 'MomentBookmarkFolderResponseDto',
  },
])('$kind 收藏夹管理', (subject) => {
  let app: NestFastifyApplication;
  let token: string;
  const tx = {
    bookmarkFolder: catalog(),
    momentBookmarkFolder: catalog(),
    userBookmark: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    momentBookmark: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
  const prisma = {
    $transaction: jest.fn((run: (value: typeof tx) => unknown) => run(tx)),
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'owner', deletedAt: null, sanctions: [] }),
    },
  };
  beforeAll(async () => {
    const secret = 'folder-management-unit-test-secret';
    token = new JwtService({ secret }).sign({ sub: 'owner' });
    const module = await Test.createTestingModule({
      controllers: [BookmarksController, MomentsController],
      providers: [
        BookmarksService,
        MomentBookmarksService,
        JwtStrategy,
        { provide: ConfigService, useValue: { get: () => secret } },
        { provide: PrismaService, useValue: prisma },
        { provide: MomentAccessService, useValue: {} },
        { provide: MomentsService, useValue: {} },
        { provide: MomentCommentsService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app.useGlobalGuards(new GlobalAuthGuard(new Reflector()));
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app?.close());
  const request = (
    method: 'PATCH' | 'DELETE',
    id = 'custom',
    payload?: object,
    authenticated = true,
  ) =>
    app.inject({
      method,
      url: `${subject.path}/${id}`,
      payload,
      headers: authenticated ? { authorization: `Bearer ${token}` } : {},
    });

  it('trim 后重命名，响应含真实可见计数且无内部字段；静态路由正确命中', async () => {
    const response = await request('PATCH', 'custom', { name: `  ${'名'.repeat(24)}  ` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      id: 'custom',
      name: '名'.repeat(24),
      isDefault: false,
      createdAt: folder.createdAt.toISOString(),
      ...(subject.kind === '主题帖'
        ? { bookmarkCount: 3, momentBookmarkCount: 2 }
        : { momentBookmarkCount: 3 }),
    });
    expect(tx[subject.model].update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'custom', userId: 'owner' },
        data: { name: '名'.repeat(24) },
      }),
    );
  });
  it.each([
    {},
    { name: '' },
    { name: ' \n\t ' },
    { name: '名'.repeat(25) },
    { name: null },
    { name: 7 },
  ])('无效名称 %j 返回 400 且无写入', async (payload) => {
    const response = await request('PATCH', 'custom', payload);
    expect(response.statusCode).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['PATCH', 'DELETE'] as const)('%s 未登录返回 401，使用写认证模式', async (method) => {
    const response = await request(
      method,
      'custom',
      method === 'PATCH' ? { name: '新名' } : undefined,
      false,
    );
    expect(response.statusCode).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const handler = Reflect.get(
      subject.controller.prototype,
      method === 'PATCH' ? subject.rename : subject.remove,
    );
    expect(Reflect.getMetadata(AUTH_MODE_KEY, handler)).toBe(AuthMode.WRITE);
  });
  it.each(['PATCH', 'DELETE'] as const)('%s 默认夹返回 409', async (method) => {
    tx[subject.model].findFirst.mockResolvedValueOnce({ ...folder, isDefault: true });
    const response = await request(
      method,
      'default',
      method === 'PATCH' ? { name: '新名' } : undefined,
    );
    expect(response.statusCode).toBe(409);
    expect(tx[subject.model].update).not.toHaveBeenCalled();
    expect(tx[subject.records].updateMany).not.toHaveBeenCalled();
  });
  it.each(['PATCH', 'DELETE'] as const)(
    '%s 不存在和越权统一 404，不应用旧动态夹映射',
    async (method) => {
      for (const id of ['missing', 'foreign']) {
        tx[subject.model].findFirst.mockResolvedValueOnce(null);
        const response = await request(
          method,
          id,
          method === 'PATCH' ? { name: '新名' } : undefined,
        );
        expect(response.statusCode).toBe(404);
        expect(response.json().data).toBeNull();
        expect(tx[subject.model].findFirst).toHaveBeenLastCalledWith({
          where: { id, userId: 'owner' },
        });
      }
      expect(tx[subject.model].update).not.toHaveBeenCalled();
      expect(tx[subject.model].delete).not.toHaveBeenCalled();
      if (subject.kind === '动态') expect(tx.bookmarkFolder.findFirst).not.toHaveBeenCalled();
    },
  );
  it('同目录重名返回 409', async () => {
    tx[subject.model].update.mockRejectedValueOnce({ code: 'P2002' });
    expect((await request('PATCH', 'custom', { name: '重复' })).statusCode).toBe(409);
  });
  it.each([0, 3])('迁移 %i 条收藏并返回明确删除 DTO', async (count) => {
    tx[subject.records].updateMany.mockResolvedValueOnce({ count });
    const response = await request('DELETE');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      deletedFolderId: 'custom',
      destinationFolderId: 'default',
    });
    expect(tx[subject.records].updateMany).toHaveBeenCalledWith({
      where: { userId: 'owner', folderId: 'custom' },
      data: { folderId: 'default' },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it.each(['P2003', 'P2014', 'P2025', 'P2034'])(
    '删除冲突 %s 返回可重试 409，不泄露数据库详情',
    async (code) => {
      tx[subject.model].delete.mockRejectedValueOnce({
        code,
        message: 'internal database details',
      });
      const response = await request('DELETE');
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        data: null,
        message: expect.stringContaining('重试'),
      });
      expect(response.body).not.toContain('internal');
    },
  );
  it('Prisma 未分类的 PostgreSQL RESTRICT 冲突仍返回可重试 409', async () => {
    tx[subject.model].delete.mockRejectedValueOnce(
      new Prisma.PrismaClientUnknownRequestError(
        'ConnectorError: PostgresError { code: "23001", message: "fixture restrict conflict" }',
        { clientVersion: Prisma.prismaVersion.client },
      ),
    );
    const response = await request('DELETE');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ data: null, message: expect.stringContaining('重试') });
    expect(response.body).not.toContain('fixture');
  });
  it('未知数据库失败不伪造成功', async () => {
    tx[subject.records].updateMany.mockRejectedValueOnce(new Error('test database unavailable'));
    expect((await request('DELETE')).statusCode).toBe(500);
    expect(tx[subject.model].delete).not.toHaveBeenCalled();
  });
  it('OpenAPI operationId、认证和成功响应 DTO 精确一致', () => {
    const contract = JSON.parse(
      readFileSync(join(__dirname, '../../contracts/openapi.json'), 'utf8'),
    );
    for (const method of ['patch', 'delete']) {
      const operation = contract.paths[`/api/v1${subject.path}/{id}`][method];
      const name = method === 'patch' ? subject.rename : subject.remove;
      const operationId = subject.prefix + name[0].toUpperCase() + name.slice(1);
      expect(operation.operationId).toBe(operationId);
      expect(operation['x-auth-mode']).toBe('authenticated');
      expect(operation.security).toEqual([{ bearer: [] }]);
      const envelopeRef = operation.responses['200'].content['application/json'].schema.$ref;
      const envelope = contract.components.schemas[envelopeRef.split('/').at(-1)];
      expect(envelope.allOf[1].properties.data.$ref).toBe(
        `#/components/schemas/${method === 'patch' ? subject.response : 'DeleteBookmarkFolderResponseDto'}`,
      );
      for (const status of ['401', '403', '404', '409'])
        expect(operation.responses[status]).toBeDefined();
    }
  });
});
