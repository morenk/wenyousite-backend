import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

const mockPrisma = {
  thread: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  subscription: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<SubscriptionsService>(SubscriptionsService);
    jest.clearAllMocks();
  });

  it('创建 THREAD 订阅应该成功', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1' });
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    mockPrisma.subscription.create.mockResolvedValue({ id: 's1', type: 'THREAD' });
    const result = await service.create('u1', 't1', 'THREAD');
    expect(result.type).toBe('THREAD');
  });

  it('创建 USER 订阅应该验证用户存在', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1' });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.create('u1', 't1', 'USER', 'bad')).rejects.toThrow(NotFoundException);
  });

  it('重复订阅应该返回409', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1' });
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.create('u1', 't1', 'THREAD')).rejects.toThrow(ConflictException);
  });

  it('取消订阅应该验证所有权', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 's1', userId: 'other' });
    await expect(service.remove('s1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('取消订阅应该成功', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
    mockPrisma.subscription.delete.mockResolvedValue({});
    await service.remove('s1', 'u1');
    expect(mockPrisma.subscription.delete).toHaveBeenCalled();
  });
});
