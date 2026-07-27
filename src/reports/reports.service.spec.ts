import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

const mockPrisma = {
  report: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ReportsService>(ReportsService);
    jest.clearAllMocks();
  });

  it('创建举报应该成功', async () => {
    mockPrisma.report.create.mockResolvedValue({ id: 'r1', status: 'PENDING' });
    const result = await service.create('u1', 'POST', 'p1', '违规');
    expect(result.status).toBe('PENDING');
  });

  it('处理举报应该记录管理员和时间', async () => {
    mockPrisma.report.findUnique.mockResolvedValue({ id: 'r1', status: 'PENDING' });
    mockPrisma.report.update.mockResolvedValue({
      id: 'r1', status: 'RESOLVED', handledBy: 'admin1', handledAt: new Date(),
    });
    const result = await service.handle('r1', 'admin1', 'RESOLVED');
    expect(result.status).toBe('RESOLVED');
    expect(result.handledBy).toBe('admin1');
  });

  it('处理已处理的举报应该返回403', async () => {
    mockPrisma.report.findUnique.mockResolvedValue({ id: 'r1', status: 'RESOLVED' });
    await expect(service.handle('r1', 'admin1', 'DISMISSED')).rejects.toThrow(ForbiddenException);
  });

  it('处理不存在的举报应该返回404', async () => {
    mockPrisma.report.findUnique.mockResolvedValue(null);
    await expect(service.handle('x', 'admin1', 'RESOLVED')).rejects.toThrow(NotFoundException);
  });
});
