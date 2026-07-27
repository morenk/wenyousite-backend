import { Test, TestingModule } from '@nestjs/testing';
import { DraftsService } from './drafts.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  subthread: { findUnique: jest.fn() },
  draft: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
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
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
    mockPrisma.draft.findMany.mockResolvedValue([{ slot: 1 }, { slot: 3 }]);
    mockPrisma.draft.create.mockResolvedValue({ id: 'd1', slot: 2 });
    const result = await service.create({ content: 'test', subthreadId: 's1' }, 'u1');
    expect(result.slot).toBe(2);
  });

  it('指定 slot 应该覆盖旧草稿', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'old' });
    mockPrisma.draft.delete.mockResolvedValue({});
    mockPrisma.draft.create.mockResolvedValue({ id: 'd1', slot: 3 });
    const result = await service.create({ content: 'test', subthreadId: 's1', slot: 3 }, 'u1');
    expect(result.slot).toBe(3);
  });

  it('5槽位全满应该覆盖最旧的', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1' });
    mockPrisma.draft.findMany.mockResolvedValue([
      { slot: 1 }, { slot: 2 }, { slot: 3 }, { slot: 4 }, { slot: 5 },
    ]);
    mockPrisma.draft.findFirst.mockResolvedValue({ id: 'oldest', slot: 1 });
    mockPrisma.draft.delete.mockReset().mockResolvedValue({});
    mockPrisma.draft.create.mockResolvedValue({ id: 'd1', slot: 1 });
    const result = await service.create({ content: 'test', subthreadId: 's1' }, 'u1');
    expect(result.slot).toBe(1);
    expect(mockPrisma.draft.delete).toHaveBeenCalledWith({ where: { id: 'oldest' } });
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
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1' });
    mockPrisma.draft.update.mockResolvedValue({ id: 'd1', content: 'updated' });
    const result = await service.update('d1', 'updated', 'u1');
    expect(result.content).toBe('updated');
  });

  it('remove 应该删除草稿', async () => {
    mockPrisma.draft.findUnique.mockResolvedValue({ id: 'd1', userId: 'u1' });
    mockPrisma.draft.delete.mockResolvedValue({});
    await service.remove('d1', 'u1');
    expect(mockPrisma.draft.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });

  it('slotUsage 应该返回各子贴槽位使用数', async () => {
    mockPrisma.draft.groupBy.mockResolvedValue([
      { subthreadId: 's1', _count: { slot: 3 } },
      { subthreadId: 's2', _count: { slot: 1 } },
    ]);
    const result = await service.slotUsage('u1');
    expect(result).toHaveLength(2);
    expect(result[0].usedSlots).toBe(3);
  });
});
