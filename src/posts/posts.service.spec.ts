import { Test, TestingModule } from '@nestjs/testing';
import { PostsService } from './posts.service';
import { PrismaService } from '../prisma/prisma.service';
import { MentionsService } from '../mentions/mentions.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

const mockPrisma = {
  $transaction: jest.fn(),
  user: {
    findUnique: jest.fn(),
  },
  subthread: {
    findUnique: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  post: {
    findUnique: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockMentions = { parseAndCreate: jest.fn() };
const mockNotification = { notify: jest.fn() };

describe('PostsService', () => {
  let service: PostsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MentionsService, useValue: mockMentions },
        { provide: NotificationProducer, useValue: mockNotification },
      ],
    }).compile();
    service = module.get<PostsService>(PostsService);
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
  });

  it('create 新楼层应该正确分配 floorNumber', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
    const subthread = { id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS' };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.post.aggregate.mockResolvedValue({ _max: { floorNumber: 5 } });
    mockPrisma.post.create.mockResolvedValue({
      id: 'p1', floorNumber: 6, content: 'test', author: { username: 'test' },
    });
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p1', floorNumber: 6, content: 'test', author: { username: 'test' } }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    const result = await service.create('s1', { content: 'test' }, 'u1');
    expect(result.floorNumber).toBe(6);
  });

  it('create 楼中楼回复不应该有 floorNumber', async () => {
    const subthread = { id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS' };
    const parent = { id: 'p1' };
    mockPrisma.subthread.findUnique.mockResolvedValue(subthread);
    mockPrisma.post.findUnique.mockResolvedValue(parent);
    mockPrisma.post.create.mockResolvedValue({
      id: 'p2', floorNumber: null, parentPostId: 'p1', content: 'reply',
    });
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      const tx = {
        post: {
          aggregate: jest.fn().mockResolvedValue({ _max: { floorNumber: 5 } }),
          create: jest.fn().mockResolvedValue({ id: 'p2', floorNumber: null, parentPostId: 'p1', content: 'reply' }),
        },
        subthread: { update: jest.fn() },
      };
      return fn(tx);
    });

    const result = await service.create('s1', { content: 'reply', parentPostId: 'p1' }, 'u1');
    expect(result.floorNumber).toBeNull();
    expect(result.parentPostId).toBe('p1');
  });

  it('create COLLABORATORS 权限子贴非协作者应该返回403', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({
      id: 's1', threadId: 't1', postingPolicy: 'COLLABORATORS',
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    await expect(service.create('s1', { content: 'test' }, 'u1')).rejects.toThrow(ForbiddenException);
  });

  it('create 不存在的父楼层应该返回404', async () => {
    mockPrisma.subthread.findUnique.mockResolvedValue({ id: 's1', threadId: 't1', postingPolicy: 'PARTICIPANTS' });
    mockPrisma.post.findUnique.mockResolvedValue(null);
    await expect(service.create('s1', { content: 'test', parentPostId: 'x' }, 'u1')).rejects.toThrow(NotFoundException);
  });

  it('update 编辑自己的帖子应该成功', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u1' });
    mockPrisma.post.update.mockResolvedValue({ id: 'p1', content: '编辑后' });
    const result = await service.update('p1', { content: '编辑后' }, 'u1');
    expect(result.content).toBe('编辑后');
  });

  it('update 编辑他人的帖子应该返回403', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'other' });
    await expect(service.update('p1', { content: 'x' }, 'u1')).rejects.toThrow(ForbiddenException);
  });

  it('remove 软删除非第一楼应该成功', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u1', floorNumber: 3 });
    mockPrisma.post.update.mockResolvedValue({ id: 'p1', deletedAt: new Date() });
    await service.remove('p1', 'u1');
    expect(mockPrisma.post.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('remove 第一楼应该返回403', async () => {
    mockPrisma.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u1', floorNumber: 1, parentPostId: null });
    await expect(service.remove('p1', 'u1')).rejects.toThrow(ForbiddenException);
  });
});
