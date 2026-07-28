import { Test, TestingModule } from '@nestjs/testing';
import { ThreadsService } from './threads.service';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

const mockPrisma = {
  $transaction: jest.fn(),
  thread: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  subthread: {
    create: jest.fn(),
  },
  post: {
    create: jest.fn(),
  },
  threadTopicTag: {
    createMany: jest.fn(),
  },
  userFollow: {
    findMany: jest.fn(),
  },
  threadInvite: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
};

const mockTags = { findOrCreate: jest.fn() };
const mockNotificationProducer = { notify: jest.fn().mockResolvedValue(undefined) };

describe('ThreadsService', () => {
  let service: ThreadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TagsService, useValue: mockTags },
        { provide: NotificationProducer, useValue: mockNotificationProducer },
      ],
    }).compile();
    service = module.get<ThreadsService>(ThreadsService);
    jest.clearAllMocks();
  });

  it('create 应该在事务内创建并通知粉丝', async () => {
    const thread = { id: 't1', title: '测试', ownerId: 'u1', category: 'RPG' };
    const subthread = { id: 's1', threadId: 't1' };
    mockPrisma.thread.findUnique.mockResolvedValue(thread);
    mockPrisma.subthread.create.mockResolvedValue(subthread);
    mockPrisma.userFollow.findMany.mockResolvedValue([
      { followerId: 'f1' }, { followerId: 'f2' },
    ]);
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        thread: {
          create: jest.fn().mockResolvedValue(thread),
          findUnique: jest.fn().mockResolvedValue(thread),
        },
        subthread: { create: jest.fn().mockResolvedValue(subthread) },
        post: { create: jest.fn().mockResolvedValue({ id: 'p1' }) },
        threadMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
        threadTopicTag: { createMany: jest.fn() },
      };
      return fn(tx);
    });

    const result = await service.create(
      { title: '测试', content: '正文', category: 'RPG' },
      'u1',
    );
    expect(result).toBeDefined();
    expect(mockNotificationProducer.notify).toHaveBeenCalledWith(
      'thread_created',
      ['f1', 'f2'],
      expect.any(String),
      expect.objectContaining({ threadId: 't1', fromUserId: 'u1' }),
    );
  });

  it('findById 应该返回主题帖详情并递增 viewCount', async () => {
    const thread = { id: 't1', title: '测试', owner: { id: 'u1' }, subthreads: [] };
    mockPrisma.thread.findUnique.mockResolvedValue(thread);
    mockPrisma.thread.update.mockResolvedValue({});
    const result = await service.findById('t1');
    expect(result.id).toBe('t1');
    expect(mockPrisma.thread.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { viewCount: { increment: 1 } },
    });
  });

  it('findById 不存在应该返回404', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue(null);
    await expect(service.findById('x')).rejects.toThrow(NotFoundException);
  });

  it('update 应该验证管理权限', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1' });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.thread.update.mockResolvedValue({ id: 't1', title: '新标题' });

    const result = await service.update('t1', { title: '新标题' }, 'u1');
    expect(result.title).toBe('新标题');
  });

  it('update 无权限应该返回403', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1' });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    await expect(service.update('t1', { title: 'x' }, 'u2')).rejects.toThrow(ForbiddenException);
  });

  it('remove 仅楼主可删除', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1' });
    await expect(service.remove('t1', 'u2')).rejects.toThrow(ForbiddenException);
  });

  it('assertCanManage OWNER 应该通过', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    await expect(service.assertCanManage('t1', 'u1')).resolves.toBeDefined();
  });

  it('assertCanManage COLLABORATOR 应该通过', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'COLLABORATOR' });
    await expect(service.assertCanManage('t1', 'u1')).resolves.toBeDefined();
  });

  it('assertCanManage PARTICIPANT 应该返回403', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    await expect(service.assertCanManage('t1', 'u1')).rejects.toThrow(ForbiddenException);
  });

  it('findAll 应该优先排列置顶帖', async () => {
    mockPrisma.thread.findMany.mockResolvedValue([]);
    await service.findAll({});
    expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      }),
    );
  });

  it('findAll 应该只展示公开帖', async () => {
    mockPrisma.thread.findMany.mockResolvedValue([]);
    await service.findAll({});
    expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ visibility: 'PUBLIC' }),
      }),
    );
  });

  it('findById 私密帖非成员应返回404', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PRIVATE' });
    mockPrisma.threadMember.findUnique.mockResolvedValue(null);
    mockPrisma.thread.update.mockResolvedValue({});
    await expect(service.findById('t1', 'u2')).rejects.toThrow(NotFoundException);
  });

  it('findById 私密帖成员应正常返回', async () => {
    const thread = { id: 't1', title: '私密帖', visibility: 'PRIVATE', owner: { id: 'u1' }, subthreads: [] };
    mockPrisma.thread.findUnique.mockResolvedValue(thread);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.thread.update.mockResolvedValue({});
    const result = await service.findById('t1', 'u3');
    expect(result.id).toBe('t1');
  });

  it('findById 私密帖未登录应返回404', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PRIVATE' });
    mockPrisma.thread.update.mockResolvedValue({});
    await expect(service.findById('t1')).rejects.toThrow(NotFoundException);
  });

  it('createInviteLink 公开帖应返回403', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', visibility: 'PUBLIC' });
    await expect(service.createInviteLink('t1', 'u1')).rejects.toThrow(ForbiddenException);
  });

  it('createInviteLink 应生成令牌', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', visibility: 'PRIVATE' });
    mockPrisma.threadInvite.upsert.mockResolvedValue({ id: 'inv1', threadId: 't1', token: expect.any(String) });
    const result = await service.createInviteLink('t1', 'u1');
    expect(result.token).toBeDefined();
  });

  it('joinByInviteLink 应加入成员', async () => {
    mockPrisma.threadInvite.findUnique.mockResolvedValue({
      threadId: 't1', thread: { id: 't1', visibility: 'PRIVATE' },
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue(null);
    mockPrisma.threadMember.create.mockResolvedValue({ id: 'm1', thread: {}, user: {} });
    const result = await service.joinByInviteLink('token123', 'u2');
    expect(result.id).toBe('m1');
  });
});
