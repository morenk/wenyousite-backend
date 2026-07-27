import { Test, TestingModule } from '@nestjs/testing';
import { ReadingProgressService } from './reading-progress.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  userReadProgress: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
};

describe('ReadingProgressService', () => {
  let service: ReadingProgressService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadingProgressService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ReadingProgressService>(ReadingProgressService);
    jest.clearAllMocks();
  });

  it('findBySubthread 应该返回进度', async () => {
    mockPrisma.userReadProgress.findUnique.mockResolvedValue({
      id: 'rp1', userId: 'u1', postId: 'p1',
      post: { id: 'p1', floorNumber: 3 },
    });
    const result = await service.findBySubthread('u1', 's1');
    expect(result?.postId).toBe('p1');
  });

  it('update 应该 upsert 进度', async () => {
    mockPrisma.userReadProgress.upsert.mockResolvedValue({ id: 'rp1', postId: 'p2' });
    const result = await service.update('u1', 's1', 'p2');
    expect(result.postId).toBe('p2');
    expect(mockPrisma.userReadProgress.upsert).toHaveBeenCalledWith({
      where: { userId_subthreadId: { userId: 'u1', subthreadId: 's1' } },
      create: { userId: 'u1', subthreadId: 's1', postId: 'p2' },
      update: { postId: 'p2', updatedAt: expect.any(Date) },
    });
  });

  it('update 不传 postId 应该仅更新时间', async () => {
    mockPrisma.userReadProgress.upsert.mockResolvedValue({ id: 'rp1' });
    const result = await service.update('u1', 's1');
    expect(result.id).toBe('rp1');
  });
});
