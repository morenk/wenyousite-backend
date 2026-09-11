import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';
import { DiceService } from '../dice/dice.service';
import { PrismaService } from '../prisma/prisma.service';
import { StickerContentService } from '../stickers/sticker-content.service';
import { MediaReferenceService } from '../media/media-reference.service';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../common/interceptors/response.interceptor';

// 使用真实 Controller/DTO/Service/解析器和响应层，认证上下文与持久化由测试提供。
// Fastify inject 不监听端口、不连接任何数据库，不替代完整认证/数据库 E2E。
describe('正文块边界 HTTP 契约', () => {
  let app: NestFastifyApplication;
  const create = jest.fn(({ data }: { data: { content: string } }) => ({
    id: 'draft',
    ...data,
    version: 1,
  }));
  const tx = { $queryRaw: jest.fn(), draft: { findMany: jest.fn().mockResolvedValue([]), create } };
  const prisma = { $transaction: jest.fn((run: (value: typeof tx) => unknown) => run(tx)) };
  const media = { syncDraftContent: jest.fn() };
  const stickers = { assertContentAllowed: jest.fn().mockResolvedValue([]) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DraftsController],
      providers: [
        DraftsService,
        DiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: StickerContentService, useValue: stickers },
        { provide: MediaReferenceService, useValue: media },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', async (request: object) => {
        Object.assign(request, { user: { id: 'boundary-test-user' } });
      });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });
  it.each(['正文', '## 标题', '### 小标题', '![图片](https://cdn.example.com/boundary.png)'])(
    'HTTP 201 原样保存无前置空行的对齐目标 %s',
    async (target) => {
      const content = `前文\r\n[wenyousite-align-v1-center]: #\r\n${target}`;
      const response = await app.inject({ method: 'POST', url: '/drafts', payload: { content } });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        code: 0,
        data: { content: content.replace(/\r\n/g, '\n') },
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(media.syncDraftContent).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['<br />', '- 列表', '> 引用', '\n正文', '[链接](ftp://example.com)'])(
    'HTTP 400/40009 拒绝目标 %s 且没有写入副作用',
    async (target) => {
      const content = `前文\n[wenyousite-align-v1-right]: #\n${target}`;
      const response = await app.inject({ method: 'POST', url: '/drafts', payload: { content } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 40009, data: null });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(media.syncDraftContent).not.toHaveBeenCalled();
      expect(stickers.assertContentAllowed).not.toHaveBeenCalled();
    },
  );
});
