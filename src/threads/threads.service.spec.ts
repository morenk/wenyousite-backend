import { Test, TestingModule } from '@nestjs/testing';
import { ThreadsService } from './threads.service';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
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
};

const mockTags = { findOrCreate: jest.fn() };

describe('ThreadsService', () => {
  let service: ThreadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TagsService, useValue: mockTags },
      ],
    }).compile();
    service = module.get<ThreadsService>(ThreadsService);
    jest.clearAllMocks();
  });

  it('create 应该在事务内创建 Thread+Subthread+Post+Member', async () => {
    const thread = { id: 't1', title: '测试', ownerId: 'u1', category: 'RPG' };
    const subthread = { id: 's1', threadId: 't1' };
    mockPrisma.thread.findUnique.mockResolvedValue(thread);
    mockPrisma.subthread.create.mockResolvedValue(subthread);
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
  });

  it('findById 应该返回主题帖详情', async () => {
    const thread = { id: 't1', title: '测试', owner: { id: 'u1' }, subthreads: [] };
    mockPrisma.thread.findUnique.mockResolvedValue(thread);
    const result = await service.findById('t1');
    expect(result.id).toBe('t1');
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
});
