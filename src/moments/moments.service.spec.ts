import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { MomentsService } from './moments.service';
import { MomentFeedMode } from './dto/moment-query.dto';

const now = new Date('2026-08-08T12:00:00.000Z');

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'moment-1',
    authorId: 'user-1',
    author: {
      id: 'user-1',
      username: '温油用户',
      avatar: null,
      level: 1,
      deletedAt: null,
    },
    title: '第一条动态',
    content: '正文',
    textCoverTheme: 'ROSE',
    coverMedia: null,
    likeCount: 0,
    commentCount: 0,
    bookmarkCount: 0,
    tipTotal: 0n,
    version: 1,
    createdAt: now,
    updatedAt: now,
    likes: [],
    bookmarks: [],
    _count: { images: 0 },
    images: [],
    ...overrides,
  };
}

function createPrismaMock() {
  const tx = {
    moment: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    momentImage: { deleteMany: jest.fn(), createMany: jest.fn() },
    momentLike: { createMany: jest.fn(), deleteMany: jest.fn() },
    momentBookmark: { createMany: jest.fn(), deleteMany: jest.fn() },
  };
  const prisma = {
    moment: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    media: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    momentBookmark: { findFirst: jest.fn(), findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx };
}

describe('MomentsService', () => {
  it('关注流要求登录', async () => {
    const { prisma } = createPrismaMock();
    const service = new MomentsService(prisma as never);

    await expect(service.list(MomentFeedMode.FOLLOWING, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('发布纯文字动态时裁剪文本并生成稳定文字封面', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new MomentsService(prisma as never);
    prisma.moment.findUnique.mockResolvedValue(null);
    tx.moment.create.mockResolvedValue({ id: 'moment-1' });
    prisma.moment.findFirst.mockResolvedValue(detailRow());

    const result = await service.create(
      {
        title: '  第一条动态  ',
        content: '  正文  ',
        mediaIds: [],
        clientRequestId: '00000000-0000-4000-8000-000000000002',
      },
      { id: 'user-1' },
    );

    expect(tx.moment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '第一条动态',
          content: '正文',
          coverMediaId: null,
          textCoverTheme: 'MINT',
        }),
      }),
    );
    expect(result.coverType).toBe('TEXT');
    expect(result.canEdit).toBe(true);
  });

  it('幂等键被不同内容复用时拒绝发布', async () => {
    const { prisma } = createPrismaMock();
    const service = new MomentsService(prisma as never);
    prisma.moment.findUnique.mockResolvedValue({ id: 'moment-1', createRequestHash: 'different' });

    await expect(
      service.create(
        {
          title: '另一条动态',
          content: '',
          mediaIds: [],
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'user-1' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('封面必须属于动态图片', async () => {
    const { prisma } = createPrismaMock();
    const service = new MomentsService(prisma as never);
    prisma.moment.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        {
          title: '图片动态',
          content: '',
          mediaIds: ['media-1'],
          coverMediaId: 'media-2',
          clientRequestId: '00000000-0000-4000-8000-000000000001',
        },
        { id: 'user-1' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('重复点赞不会重复增加计数', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new MomentsService(prisma as never);
    prisma.moment.findFirst.mockResolvedValue({ id: 'moment-1', authorId: 'user-2', title: '动态' });
    tx.momentLike.createMany.mockResolvedValue({ count: 0 });
    tx.moment.findUniqueOrThrow.mockResolvedValue({ likeCount: 7 });

    await expect(service.setLike('moment-1', { id: 'user-1' }, true)).resolves.toEqual({
      momentId: 'moment-1',
      count: 7,
      active: true,
    });
    expect(tx.moment.update).not.toHaveBeenCalled();
  });

  it('编辑版本冲突时要求刷新', async () => {
    const { prisma, tx } = createPrismaMock();
    const service = new MomentsService(prisma as never);
    prisma.moment.findUnique.mockResolvedValue({ authorId: 'user-1', coverMediaId: null, images: [] });
    tx.moment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update('moment-1', { title: '修改', version: 1 }, { id: 'user-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('动态搜索拒绝单字符关键词', async () => {
    const { prisma } = createPrismaMock();
    const service = new MomentsService(prisma as never);

    await expect(service.search('字', undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
