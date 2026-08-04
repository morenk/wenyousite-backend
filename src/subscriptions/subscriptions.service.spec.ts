import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { BusinessException } from '../common/exceptions/business.exception';

const mockPrisma = {
  thread: { findUnique: jest.fn() },
  threadMember: { findUnique: jest.fn() },
  subscription: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockThreadAccess = { assertAccessible: jest.fn().mockResolvedValue(undefined) };

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ThreadAccessService, useValue: mockThreadAccess },
      ],
    }).compile();
    service = module.get<SubscriptionsService>(SubscriptionsService);
    jest.clearAllMocks();
    mockThreadAccess.assertAccessible.mockResolvedValue(undefined);
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', published: true });
    mockPrisma.threadMember.findUnique.mockResolvedValue(null);
    mockPrisma.subscription.findFirst.mockResolvedValue(null);
  });

  it('普通用户可以创建 THREAD 官方更新订阅', async () => {
    mockPrisma.subscription.create.mockResolvedValue({ id: 's1', type: 'THREAD' });

    const result = await service.create('u1', 't1', 'THREAD');

    expect(result.type).toBe('THREAD');
    expect(mockThreadAccess.assertAccessible).toHaveBeenCalledWith('t1', 'u1');
    expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetUserId: null }) }),
    );
  });

  it('USER 订阅只允许目标为普通玩家', async () => {
    mockPrisma.threadMember.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ role: 'PARTICIPANT', playerMarked: true });
    mockPrisma.subscription.create.mockResolvedValue({ id: 's2', type: 'USER' });

    await expect(service.create('u1', 't1', 'USER', 'player1')).resolves.toMatchObject({ id: 's2' });
  });

  it.each([
    [{ role: 'PARTICIPANT', playerMarked: false }],
    [{ role: 'COLLABORATOR', playerMarked: true }],
    [null],
  ])('拒绝不符合条件的 USER 订阅目标 %#', async (target) => {
    mockPrisma.threadMember.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(target);
    await expect(service.create('u1', 't1', 'USER', 'target')).rejects.toThrow(BusinessException);
  });

  it.each(['OWNER', 'COLLABORATOR'])('拒绝 %s 创建冗余订阅', async (role) => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role });
    await expect(service.create('manager', 't1', 'THREAD')).rejects.toThrow(BusinessException);
  });

  it('拒绝 THREAD 携带 targetUserId', async () => {
    await expect(service.create('u1', 't1', 'THREAD', 'target')).rejects.toThrow(BusinessException);
  });

  it('拒绝 USER 订阅自己', async () => {
    await expect(service.create('u1', 't1', 'USER', 'u1')).rejects.toThrow(BusinessException);
  });

  it('重复订阅返回 409 业务错误', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.create('u1', 't1', 'THREAD')).rejects.toMatchObject({ status: 409 });
  });

  it('并发唯一键冲突转换为已订阅错误', async () => {
    mockPrisma.subscription.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create('u1', 't1', 'THREAD')).rejects.toMatchObject({ status: 409 });
  });

  it('取消订阅验证所有权', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 's1', userId: 'other' });
    await expect(service.remove('s1', 'u1')).rejects.toMatchObject({ status: 404 });
  });

  it('取消订阅成功', async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
    mockPrisma.subscription.delete.mockResolvedValue({});
    await service.remove('s1', 'u1');
    expect(mockPrisma.subscription.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('订阅列表只包含仍可访问的已发布主题帖', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([]);
    await service.findAll('u1');
    expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'u1',
          thread: expect.objectContaining({ published: true, deletedAt: null }),
        }),
      }),
    );
  });
});
