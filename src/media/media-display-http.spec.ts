import { Controller, Get, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { TransformInterceptor } from '../common/interceptors/response.interceptor';
import { paginate } from '../common/dto/paginated-result';
import { PrismaService } from '../prisma/prisma.service';
import { MediaDisplayProjectionService } from './media-display-projection.service';
import { MediaDisplayInterceptor } from './media-display.interceptor';

const sourceUrl = 'https://cdn.test/a.gif';
@Controller('display-fixture')
class FixtureController {
  @Get('allowed') allowed() { return paginate([{ id: 'p', threadId: 't', content: `![x](${sourceUrl})` }], { cursor: null, hasMore: false }); }
  @Get('private') private() { throw new NotFoundException(); }
  @Get('withdrawn') withdrawn() { return { content: null, media: null, recalledAt: new Date(), fromUser: { id: 'u', username: 'gone', avatar: sourceUrl, deletedAt: new Date() } }; }
}

describe('完整展示HTTP响应边界', () => {
  let app: NestFastifyApplication;
  const database = { media: { findMany: jest.fn() }, stickerAsset: { findMany: jest.fn().mockResolvedValue([]) } };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [FixtureController] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalInterceptors(new TransformInterceptor(), new MediaDisplayInterceptor(new MediaDisplayProjectionService(database as unknown as PrismaService)));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); database.media.findMany.mockResolvedValue([{ id: 'm', url: sourceUrl, purpose: 'RICH_CONTENT', displayAsset: null,
    postAttachments: [{ postId: 'p', post: { threadId: 't' } }], draftAttachments: [], avatarUser: null, profileCoverUser: null, profileCoverMobileUser: null }]); });
  it('真实分页envelope保留meta并附精确来源映射', async () => {
    const response = await app.inject({ method: 'GET', url: '/display-fixture/allowed' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 0, data: [{ mediaDisplays: [{ sourceUrl, display: null }] }], meta: { cursor: null, hasMore: false } });
  });
  it('被拒绝请求和撤回/注销内容不触发资产解析或恢复头像', async () => {
    expect((await app.inject({ method: 'GET', url: '/display-fixture/private' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/display-fixture/withdrawn' })).json()).toMatchObject({ data: { content: null, media: null, fromUser: { avatar: null } } });
    expect(database.media.findMany).not.toHaveBeenCalled();
  });
});
