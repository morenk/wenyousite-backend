import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  notification: {
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  it('findAll 应返回目标对象的删除状态 deletedAt，供前端识别已删除跳转对象', async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    await service.findAll('u1');
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          post: expect.objectContaining({ select: expect.objectContaining({ deletedAt: true }) }),
          thread: expect.objectContaining({ select: expect.objectContaining({ deletedAt: true }) }),
          fromUser: expect.objectContaining({ select: expect.objectContaining({ deletedAt: true }) }),
        },
      }),
    );
  });

  it('create 应该传递结构化导航字段', async () => {
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1', userId: 'u1' });
    await service.create('u1', 'reply', '内容', { postId: 'p1', threadId: 't1', fromUserId: 'u2' });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: { userId: 'u1', type: 'reply', content: '内容', postId: 'p1', threadId: 't1', fromUserId: 'u2' },
    });
  });

  it('create 应该支持系统通知（fromUserId 为空）', async () => {
    mockPrisma.notification.create.mockResolvedValue({ id: 'n2', userId: 'u1' });
    await service.create('u1', 'system', '系统通知内容');
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: { userId: 'u1', type: 'system', content: '系统通知内容' },
    });
  });

  it('createMany 应该批量创建', async () => {
    mockPrisma.notification.createMany.mockResolvedValue({});
    await service.createMany([
      { userId: 'u1', type: 'reply', content: 'a', postId: 'p1', threadId: 't1', fromUserId: 'u2' },
      { userId: 'u2', type: 'reply', content: 'a', postId: 'p1', threadId: 't1', fromUserId: 'u3' },
    ]);
    expect(mockPrisma.notification.createMany).toHaveBeenCalled();
  });

  it('createMany 应该支持空数组不报错', async () => {
    await service.createMany([]);
    expect(mockPrisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('unreadCount 应该返回未读数', async () => {
    mockPrisma.notification.count.mockResolvedValue(5);
    expect(await service.unreadCount('u1')).toBe(5);
  });

  it('markAllAsRead 应该标记全部已读', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });
    await service.markAllAsRead('u1');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isRead: false },
      data: { isRead: true },
    });
  });

  it('setReadStatus 应该支持标记未读', async () => {
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.setReadStatus('n1', 'u1', false);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u1' },
      data: { isRead: false },
    });
  });

  it('remove 应该硬删除单条通知', async () => {
    mockPrisma.notification.deleteMany.mockResolvedValue({ count: 1 });
    await service.remove('n1', 'u1');
    expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u1' },
    });
  });
});
