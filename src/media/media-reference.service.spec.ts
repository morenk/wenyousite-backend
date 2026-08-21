import { BadRequestException } from '@nestjs/common';
import { MediaReferenceService } from './media-reference.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MediaReferenceService', () => {
  const prisma = {
    media: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const tx = {
    media: prisma.media,
    postMedia: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    draftMedia: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  let service: MediaReferenceService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.media.updateMany.mockResolvedValue({ count: 0 });
    tx.postMedia.findMany.mockResolvedValue([]);
    tx.draftMedia.findMany.mockResolvedValue([]);
    service = new MediaReferenceService(prisma as unknown as PrismaService);
  });

  it('按正文顺序建立精确站内媒体引用，并忽略外部图片', async () => {
    const first = 'https://cdn.example.com/uploads/first.jpg';
    const second = 'https://cdn.example.com/uploads/second.jpg';
    prisma.media.findMany
      .mockResolvedValueOnce([
        { id: 'm2', url: second, status: 'COMPLETED' },
        { id: 'm1', url: first, status: 'COMPLETED' },
      ])
      .mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }]);

    await service.syncPostContent(
      tx as never,
      'p1',
      `![一](<${first}>)\n![外部](https://outside.example/a.jpg)\n![二](${second})`,
    );

    expect(tx.postMedia.createMany).toHaveBeenCalledWith({
      data: [
        { postId: 'p1', mediaId: 'm1', sortOrder: 0 },
        { postId: 'p1', mediaId: 'm2', sortOrder: 1 },
      ],
    });
    expect(prisma.media.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
      data: { orphanedAt: null },
    });
  });

  it('正文命中尚未处理完成的站内媒体时拒绝保存', async () => {
    const url = 'https://cdn.example.com/uploads/pending.jpg';
    prisma.media.findMany.mockResolvedValue([{ id: 'pending', url, status: 'PROCESSING' }]);

    await expect(service.syncDraftContent(tx as never, 'd1', `![图](${url})`)).rejects.toThrow(
      BadRequestException,
    );

    expect(tx.draftMedia.deleteMany).not.toHaveBeenCalled();
  });

  it('解绑最后一个引用后为已完成媒体启动宽限期', async () => {
    tx.postMedia.findMany.mockResolvedValue([{ mediaId: 'm1' }]);
    prisma.media.findMany.mockResolvedValue([]);

    await service.releasePostContent(tx as never, 'p1');

    expect(tx.postMedia.deleteMany).toHaveBeenCalledWith({ where: { postId: 'p1' } });
    expect(prisma.media.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1'] }, status: 'COMPLETED' },
      data: { orphanedAt: expect.any(Date) },
    });
  });
});
