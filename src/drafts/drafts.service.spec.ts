import { Test, TestingModule } from '@nestjs/testing';
import { DraftsService } from './drafts.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { DiceService } from '../dice/dice.service';
import { StickerContentService } from '../stickers/sticker-content.service';
import { MediaReferenceService } from '../media/media-reference.service';
import { hashIdempotencyPayload } from '../common/idempotency';

const mockPrisma = {
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  draft: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const publicDraftSelect = {
  id: true,
  userId: true,
  slot: true,
  content: true,
  version: true,
  createdAt: true,
  updatedAt: true,
};

const mockStickerContent = {
  assertContentAllowed: jest.fn(),
};

const mockMediaReferences = {
  syncDraftContent: jest.fn(),
  releaseDraftContent: jest.fn(),
};

describe('DraftsService', () => {
  let service: DraftsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockStickerContent.assertContentAllowed.mockResolvedValue([]);
    mockMediaReferences.syncDraftContent.mockResolvedValue(undefined);
    mockMediaReferences.releaseDraftContent.mockResolvedValue(undefined);
    mockPrisma.$transaction.mockImplementation((callback: (tx: typeof mockPrisma) => unknown) =>
      callback(mockPrisma),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DraftsService,
        DiceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StickerContentService, useValue: mockStickerContent },
        { provide: MediaReferenceService, useValue: mockMediaReferences },
      ],
    }).compile();
    service = module.get<DraftsService>(DraftsService);
  });

  it('自动保存应该选择空闲 slot', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([{ slot: 1 }, { slot: 3 }]);
    mockPrisma.draft.create.mockResolvedValue({ id: 'd1', slot: 2 });
    const result = await service.create({ content: 'test' }, 'u1');
    expect(result.slot).toBe(2);
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 15_000,
    });
  });

  it('指定 slot 应该覆盖旧草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'old', slot: 3, userId: 'u1', version: 2 });
    mockPrisma.draft.update.mockResolvedValue({
      id: 'old',
      slot: 3,
      content: 'updated',
      version: 3,
    });
    const result = await service.create({ content: 'updated', slot: 3, version: 2 }, 'u1');
    expect(result.content).toBe('updated');
    expect(mockPrisma.draft.update).toHaveBeenCalledWith({
      where: { id: 'old', version: 2 },
      data: { content: 'updated', version: { increment: 1 } },
      select: publicDraftSelect,
    });
  });

  it('create 应规范化正文后写入草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'old', slot: 1, userId: 'u1', version: 1 });
    mockPrisma.draft.update.mockResolvedValue({ id: 'old', slot: 1, content: '正文\n<br />\n' });

    await service.create({ content: '正文\r\n<br>\r\n![空]()', slot: 1, version: 1 }, 'u1');

    expect(mockPrisma.draft.update).toHaveBeenCalledWith({
      where: { id: 'old', version: 1 },
      data: { content: '正文\n<br />\n', version: { increment: 1 } },
      select: publicDraftSelect,
    });
  });

  it('允许纯骰子云草稿，并把节点位置作为正文快照写入', async () => {
    const node = '[[dice:v1:550e8400-e29b-41d4-a716-446655440000:2D6 + 03]]';
    mockPrisma.draft.findUnique.mockResolvedValue(null);
    mockPrisma.draft.create.mockResolvedValue({
      id: 'd-dice',
      slot: 2,
      content: node,
      version: 1,
    });

    await service.create({ content: node, slot: 2 }, 'u1');

    expect(mockPrisma.draft.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        slot: 2,
        content: '[[dice:v1:550e8400-e29b-41d4-a716-446655440000:2d6+3]]',
      },
      select: publicDraftSelect,
    });
  });

  it('正文与待掷骰子同时为空时拒绝保存', async () => {
    await expect(service.create({ content: '' }, 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.BAD_REQUEST,
    });
    expect(mockPrisma.draft.create).not.toHaveBeenCalled();
    expect(mockPrisma.draft.update).not.toHaveBeenCalled();
  });

  it('覆盖已有 slot 缺少或不匹配 version 应返回 409', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'old', slot: 1, userId: 'u1', version: 3 });

    for (const dto of [
      { content: '新内容', slot: 1 },
      { content: '新内容', slot: 1, version: 2 },
    ]) {
      await expect(service.create(dto, 'u1')).rejects.toMatchObject({
        errorCode: ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
        status: HttpStatus.CONFLICT,
      });
    }
    expect(mockPrisma.draft.update).not.toHaveBeenCalled();
  });

  it('指定槽位已经删除时不得用旧 version 复活草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ content: '离线旧正文', slot: 1, version: 2 }, 'u1'),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      status: HttpStatus.CONFLICT,
    });
    expect(mockPrisma.draft.create).not.toHaveBeenCalled();
  });

  it('5 槽满应返回错误', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([
      { slot: 1 },
      { slot: 2 },
      { slot: 3 },
      { slot: 4 },
      { slot: 5 },
    ]);
    await expect(service.create({ content: 'test' }, 'u1')).rejects.toThrow(BadRequestException);
  });

  it('自动分配遭遇旧写入路径的唯一键竞争时会重新扫描空闲槽位', async () => {
    mockPrisma.draft.findMany
      .mockResolvedValueOnce([{ slot: 1 }])
      .mockResolvedValueOnce([{ slot: 1 }, { slot: 2 }]);
    mockPrisma.draft.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 'd3', slot: 3 });

    await expect(service.create({ content: 'test' }, 'u1')).resolves.toMatchObject({ slot: 3 });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('相同 clientRequestId 与规范化载荷应返回首次创建结果', async () => {
    const clientRequestId = '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77';
    const existing = {
      id: 'd1',
      userId: 'u1',
      slot: 2,
      content: '正文\n',
      version: 1,
      createRequestHash: hashIdempotencyPayload({ content: '正文\n', slot: null }),
    };
    mockPrisma.draft.findUnique.mockResolvedValue(existing);

    const result = await service.create({ content: '正文\r\n', clientRequestId }, 'u1');
    expect(result).toMatchObject({ id: 'd1', slot: 2, content: '正文\n' });
    expect(result).not.toHaveProperty('createRequestHash');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('同一 clientRequestId 复用于不同载荷时应返回 40912', async () => {
    const clientRequestId = '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77';
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      createRequestHash: hashIdempotencyPayload({ content: '旧正文', slot: null }),
    });

    await expect(
      service.create({ content: '新正文', clientRequestId }, 'u1'),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.IDEMPOTENCY_KEY_REUSED,
      status: HttpStatus.CONFLICT,
    });
  });

  it('并发幂等唯一键竞争应读取并返回首次创建结果', async () => {
    const clientRequestId = '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77';
    const requestHash = hashIdempotencyPayload({ content: '正文', slot: null });
    const existing = {
      id: 'd1',
      userId: 'u1',
      slot: 1,
      content: '正文',
      version: 1,
      createRequestHash: requestHash,
    };
    mockPrisma.draft.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    mockPrisma.draft.findMany.mockResolvedValue([]);
    mockPrisma.draft.create.mockRejectedValue({ code: 'P2002' });

    const result = await service.create({ content: '正文', clientRequestId }, 'u1');
    expect(result).toMatchObject({ id: 'd1', slot: 1, content: '正文' });
    expect(result).not.toHaveProperty('createRequestHash');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('指定空槽位的并发幂等重放应返回先完成的创建结果', async () => {
    const clientRequestId = '6f9619ff-8b86-4e4b-a59b-19a25f6d6f77';
    const requestHash = hashIdempotencyPayload({ content: '正文', slot: 2 });
    const existing = {
      id: 'd2',
      userId: 'u1',
      slot: 2,
      content: '正文',
      version: 1,
      createRequestHash: requestHash,
    };
    mockPrisma.draft.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'd2' })
      .mockResolvedValueOnce(existing);

    const result = await service.create({ content: '正文', slot: 2, clientRequestId }, 'u1');
    expect(result).toMatchObject({ id: 'd2', slot: 2, content: '正文' });
    expect(mockPrisma.draft.create).not.toHaveBeenCalled();
  });

  it('findById 应该返回草稿', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', content: 'test' });
    const result = await service.findById('d1', 'u1');
    expect(result.id).toBe('d1');
  });

  it('findById 不存在或非本人草稿应该返回 40405', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(null);
    await expect(service.findById('d1', 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.DRAFT_NOT_FOUND,
      status: HttpStatus.NOT_FOUND,
    });
    expect(mockPrisma.draft.findFirst).toHaveBeenCalledWith({
      where: { id: 'd1', userId: 'u1' },
      select: publicDraftSelect,
    });
  });

  it('update 应该更新内容', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', version: 1 });
    mockPrisma.draft.update.mockResolvedValue({ id: 'd1', content: 'updated', version: 2 });
    const result = await service.update('d1', 'updated', 1, 'u1');
    expect(result.content).toBe('updated');
  });

  it('update 应规范化正文后写入草稿', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', version: 1 });
    mockPrisma.draft.update.mockResolvedValue({ id: 'd1', content: '正文\n<br />' });

    await service.update('d1', '正文\r\n<br>', 1, 'u1');

    expect(mockPrisma.draft.update).toHaveBeenCalledWith({
      where: { id: 'd1', version: 1 },
      data: { content: '正文\n<br />', version: { increment: 1 } },
      select: publicDraftSelect,
    });
  });

  it('PATCH version 不匹配应返回 409 乐观锁冲突', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', version: 2 });

    await expect(service.update('d1', '新内容', 1, 'u1')).rejects.toBeInstanceOf(BusinessException);
    await expect(service.update('d1', '新内容', 1, 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      status: HttpStatus.CONFLICT,
    });
    expect(mockPrisma.draft.update).not.toHaveBeenCalled();
  });

  it('PATCH 条件更新竞争失败应转换为 409 乐观锁冲突', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', version: 1 });
    mockPrisma.draft.update.mockRejectedValue({ code: 'P2025' });

    await expect(service.update('d1', '新内容', 1, 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      status: HttpStatus.CONFLICT,
    });
  });

  it('remove 应按本人和 version 条件删除并释放媒体引用', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', version: 3 });
    mockPrisma.draft.deleteMany.mockResolvedValue({ count: 1 });
    await service.remove('d1', 'u1', 3);
    expect(mockMediaReferences.releaseDraftContent).toHaveBeenCalledWith(mockPrisma, 'd1');
    expect(mockPrisma.draft.deleteMany).toHaveBeenCalledWith({
      where: { id: 'd1', userId: 'u1', version: 3 },
    });
  });

  it('remove 过期 version 应返回 409 且不释放媒体', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ id: 'd1', userId: 'u1', version: 4 });
    await expect(service.remove('d1', 'u1', 3)).rejects.toMatchObject({
      errorCode: ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      status: HttpStatus.CONFLICT,
    });
    expect(mockMediaReferences.releaseDraftContent).not.toHaveBeenCalled();
  });

  it('remove 重放或越权目标不存在时应幂等成功', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(null);
    await expect(service.remove('d1', 'u1', 3)).resolves.toBeNull();
    expect(mockPrisma.draft.deleteMany).not.toHaveBeenCalled();
  });

  it('remove 并发竞争中另一请求已删除目标时应幂等成功', async () => {
    mockPrisma.draft.findFirst
      .mockResolvedValueOnce({ id: 'd1', userId: 'u1', version: 3 })
      .mockResolvedValueOnce(null);
    mockPrisma.draft.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove('d1', 'u1', 3)).resolves.toBeNull();
    expect(mockMediaReferences.releaseDraftContent).toHaveBeenCalledWith(mockPrisma, 'd1');
  });

  it('slotUsage 应该返回槽位使用数', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([{ slot: 1 }, { slot: 3 }, { slot: 5 }]);
    const result = await service.slotUsage('u1');
    expect(result.usedSlots).toBe(3);
    expect(result.maxSlots).toBe(5);
    expect(result.slots).toEqual([1, 3, 5]);
    expect(mockPrisma.draft.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { slot: true },
      orderBy: { slot: 'asc' },
    });
  });

  it('state 应从同一有序列表推导槽位状态', async () => {
    const drafts = [
      { id: 'd1', slot: 1 },
      { id: 'd3', slot: 3 },
    ];
    mockPrisma.draft.findMany.mockResolvedValue(drafts);
    await expect(service.state('u1')).resolves.toEqual({
      drafts,
      usedSlots: 2,
      maxSlots: 5,
      slots: [1, 3],
    });
  });
});
