import { Test, TestingModule } from '@nestjs/testing';
import { SubthreadsService } from './subthreads.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { BusinessException } from '../common/exceptions/business.exception';

const mockPrisma = {
  $transaction: jest.fn(),
  thread: {
    findUnique: jest.fn(),
  },
  subthread: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  post: {
    create: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
  },
};

const mockThreadAccess = { assertAccessible: jest.fn() };

describe('SubthreadsService', () => {
  let service: SubthreadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubthreadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ThreadAccessService, useValue: mockThreadAccess },
      ],
    }).compile();
    service = module.get<SubthreadsService>(SubthreadsService);
    jest.clearAllMocks();
    mockPrisma.thread.findUnique.mockResolvedValue({ visibility: 'PUBLIC', published: true, ownerId: 'u1' });
  });

  it('findAll 应过滤已软删除的子贴', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PUBLIC', published: true, ownerId: 'u1' });
    mockPrisma.subthread.findMany.mockResolvedValue([]);
    await service.findAll('t1');
    expect(mockPrisma.subthread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: 't1', deletedAt: null } }),
    );
  });

  it('remove 应设置 deletedAt 而非硬删除', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', deletedAt: null });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.subthread.update.mockResolvedValue({ id: 's1', deletedAt: new Date() });
    await service.remove('s1', 'u1');
    expect(mockPrisma.subthread.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('remove 已软删除的子贴应返回404', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', deletedAt: new Date() });
    await expect(service.remove('s1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('findById 应返回子贴详情', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ visibility: 'PUBLIC', published: true, ownerId: 'u1' });
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', thread: { id: 't1', visibility: 'PUBLIC', ownerId: 'u1', published: true } });
    const result = await service.findById('s1');
    expect(result.id).toBe('s1');
  });

  it('findById 不存在应返回404', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue(null);
    await expect(service.findById('x')).rejects.toThrow(BusinessException);
  });

  it('默认子贴不可删除', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', deletedAt: null });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    // 该帖最早的子贴就是当前子贴 → 应拒绝
    mockPrisma.subthread.findFirst.mockResolvedValue({ id: 's1' });

    await expect(service.remove('s1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('非默认子贴可正常删除', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's2', threadId: 't1', deletedAt: null });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    // 该帖最早的子贴是 s1，不是 s2 → 应放行
    mockPrisma.subthread.findFirst.mockResolvedValue({ id: 's1' });
    mockPrisma.subthread.update.mockResolvedValue({ id: 's2', deletedAt: new Date() });

    await service.remove('s2', 'u1');
    expect(mockPrisma.subthread.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's2' } }),
    );
  });
});
