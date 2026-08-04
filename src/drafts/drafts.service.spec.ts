import { Test, TestingModule } from '@nestjs/testing';
import { DraftsService } from './drafts.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

const mockPrisma = {
  draft: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('DraftsService', () => {
  let service: DraftsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DraftsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<DraftsService>(DraftsService);
    jest.clearAllMocks();
  });

  it('自动保存应该选择空闲 slot', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([{ slot: 1 }, { slot: 3 }]);
    mockPrisma.draft.create.mockResolvedValue({ id: 'd1', slot: 2 });
    const result = await service.create({ content: 'test' }, 'u1');
    expect(result.slot).toBe(2);
  });

  it('指定 slot 应该覆盖旧草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'old', slot: 3, userId: 'u1', version: 2 });
    mockPrisma.draft.update.mockResolvedValue({ id: 'old', slot: 3, content: 'updated', version: 3 });
    const result = await service.create({ content: 'updated', slot: 3, version: 2 }, 'u1');
    expect(result.content).toBe('updated');
    expect(mockPrisma.draft.update).toHaveBeenCalledWith({
      where: { id: 'old', version: 2 },
      data: { content: 'updated', version: { increment: 1 } },
    });
  });

  it('create 应规范化正文后写入草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'old', slot: 1, userId: 'u1', version: 1 });
    mockPrisma.draft.update.mockResolvedValue({ id: 'old', slot: 1, content: '正文\n<br />\n' });

    await service.create({ content: '正文\r\n<br>\r\n![空]()', slot: 1, version: 1 }, 'u1');

    expect(mockPrisma.draft.update).toHaveBeenCalledWith({
      where: { id: 'old', version: 1 },
      data: { content: '正文\n<br />\n', version: { increment: 1 } },
    });
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

  it('5 槽满应返回错误', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([
      { slot: 1 }, { slot: 2 }, { slot: 3 }, { slot: 4 }, { slot: 5 },
    ]);
    await expect(service.create({ content: 'test' }, 'u1')).rejects.toThrow(BadRequestException);
  });

  it('findById 应该返回草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1', content: 'test' });
    const result = await service.findById('d1', 'u1');
    expect(result.id).toBe('d1');
  });

  it('findById 非自己的草稿应该返回404', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'other' });
    await expect(service.findById('d1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('update 应该更新内容', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1', version: 1 });
    mockPrisma.draft.update.mockResolvedValue({ id: 'd1', content: 'updated', version: 2 });
    const result = await service.update('d1', 'updated', 1, 'u1');
    expect(result.content).toBe('updated');
  });

  it('update 应规范化正文后写入草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1', version: 1 });
    mockPrisma.draft.update.mockResolvedValue({ id: 'd1', content: '正文\n<br />' });

    await service.update('d1', '正文\r\n<br>', 1, 'u1');

    expect(mockPrisma.draft.update).toHaveBeenCalledWith({
      where: { id: 'd1', version: 1 },
      data: { content: '正文\n<br />', version: { increment: 1 } },
    });
  });

  it('PATCH version 不匹配应返回 409 乐观锁冲突', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1', version: 2 });

    await expect(service.update('d1', '新内容', 1, 'u1')).rejects.toBeInstanceOf(BusinessException);
    await expect(service.update('d1', '新内容', 1, 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      status: HttpStatus.CONFLICT,
    });
    expect(mockPrisma.draft.update).not.toHaveBeenCalled();
  });

  it('PATCH 条件更新竞争失败应转换为 409 乐观锁冲突', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1', version: 1 });
    mockPrisma.draft.update.mockRejectedValue({ code: 'P2025' });

    await expect(service.update('d1', '新内容', 1, 'u1')).rejects.toMatchObject({
      errorCode: ErrorCode.OPTIMISTIC_LOCK_CONFLICT,
      status: HttpStatus.CONFLICT,
    });
  });

  it('remove 应该删除草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1' });
    mockPrisma.draft.delete.mockResolvedValue({});
    await service.remove('d1', 'u1');
    expect(mockPrisma.draft.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('slotUsage 应该返回槽位使用数', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([{ slot: 1 }, { slot: 3 }, { slot: 5 }]);
    const result = await service.slotUsage('u1');
    expect(result.usedSlots).toBe(3);
    expect(result.maxSlots).toBe(5);
    expect(result.slots).toEqual([1, 3, 5]);
  });
});
