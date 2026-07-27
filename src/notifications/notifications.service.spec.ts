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

  it('create 应该创建通知', async () => {
    mockPrisma.notification.create.mockResolvedValue({ id: 'n1', userId: 'u1' });
    const result = await service.create('u1', 'reply', '内容');
    expect(result.id).toBe('n1');
  });

  it('createMany 应该批量创建', async () => {
    mockPrisma.notification.createMany.mockResolvedValue({});
    await service.createMany([
      { userId: 'u1', type: 'reply', content: 'a' },
      { userId: 'u2', type: 'reply', content: 'a' },
    ]);
    expect(mockPrisma.notification.createMany).toHaveBeenCalled();
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
});
