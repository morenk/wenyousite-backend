import { Test, TestingModule } from '@nestjs/testing';
import { ThreadsService } from './threads.service';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { NotificationProducer } from '../jobs/notification.producer';
import { BusinessException } from '../common/exceptions/business.exception';

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
    findFirst: jest.fn(),
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

  describe('create', () => {
    it('创建草稿帖，不通知粉丝', async () => {
      const thread = { id: 't1', title: '未命名草稿', category: 'DEDUCTION', ownerId: 'u1', published: false };
      mockPrisma.thread.create.mockResolvedValue(thread);
      mockPrisma.threadMember.create.mockResolvedValue({ id: 'm1' });
      mockPrisma.thread.findUnique.mockResolvedValue(thread);

      const result = await service.create({ title: '测试', category: 'RPG' }, 'u1');
      expect(result).toBeDefined();
      expect(mockNotificationProducer.notify).not.toHaveBeenCalled();
    });

    it('无标题时 title 为空', async () => {
      const thread = { id: 't1', title: null, category: 'DEDUCTION', published: false };
      mockPrisma.thread.create.mockResolvedValue(thread);
      mockPrisma.threadMember.create.mockResolvedValue({ id: 'm1' });
      mockPrisma.thread.findUnique.mockResolvedValue(thread);

      await service.create({}, 'u1');
      expect(mockPrisma.thread.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ title: undefined }) }),
      );
    });
  });

  describe('findDrafts', () => {
    it('返回用户的未发布帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      const result = await service.findDrafts('u1');
      expect(result).toHaveLength(2);
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'u1', published: false, deletedAt: null } }),
      );
    });
  });

  describe('findAll', () => {
    it('只展示已发布帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);
      await service.findAll({});
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ published: true }) }),
      );
    });

    it('优先排列置顶帖', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);
      await service.findAll({});
      expect(mockPrisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] }),
      );
    });
  });

  describe('findById', () => {
    it('已发布公开帖正常返回并递增 viewCount', async () => {
      const thread = { id: 't1', title: '测试', published: true, visibility: 'PUBLIC', owner: { id: 'u1' }, subthreads: [] };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.thread.update.mockResolvedValue({});
      const result = await service.findById('t1');
      expect(result.id).toBe('t1');
      expect(mockPrisma.thread.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { viewCount: { increment: 1 } },
      });
    });

    it('不存在返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue(null);
      await expect(service.findById('x')).rejects.toThrow(BusinessException);
    });

    it('未发布帖：owner 可查看', async () => {
      const thread = { id: 't1', title: '草稿', published: false, ownerId: 'u1', visibility: 'PUBLIC', owner: { id: 'u1' }, subthreads: [] };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      const result = await service.findById('t1', 'u1');
      expect(result.id).toBe('t1');
    });

    it('未发布帖：非 owner 返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', published: false, ownerId: 'u1', visibility: 'PUBLIC' });
      await expect(service.findById('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('未发布帖：未登录返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', published: false, ownerId: 'u1', visibility: 'PUBLIC' });
      await expect(service.findById('t1')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖非成员应返回404', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', published: true, visibility: 'PRIVATE' });
      mockPrisma.threadMember.findUnique.mockResolvedValue(null);
      mockPrisma.thread.update.mockResolvedValue({});
      await expect(service.findById('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖成员应正常返回', async () => {
      const thread = { id: 't1', title: '私密帖', published: true, visibility: 'PRIVATE', owner: { id: 'u1' }, subthreads: [] };
      mockPrisma.thread.findUnique.mockResolvedValue(thread);
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      mockPrisma.thread.update.mockResolvedValue({});
      const result = await service.findById('t1', 'u3');
      expect(result.id).toBe('t1');
    });
  });

  describe('update', () => {
    it('修改标题应正常', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.update.mockResolvedValue({ id: 't1', title: '新标题' });
      const result = await service.update('t1', { title: '新标题' }, 'u1');
      expect(result.title).toBe('新标题');
    });

    it('无权限返回403', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      await expect(service.update('t1', { title: 'x' }, 'u2')).rejects.toThrow(BusinessException);
    });

    it('发布时应校验并通知粉丝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: false, title: '测试', category: 'RPG' });
      mockPrisma.subthread.findFirst.mockResolvedValue({
        posts: [{ id: 'p1' }],
      });
      mockPrisma.thread.update.mockResolvedValue({
        id: 't1', title: '测试', category: 'RPG', published: true,
        owner: { id: 'u1', username: 'test', nickname: null, avatar: null },
        subthreads: [], topicTags: [], _count: { members: 1, posts: 1 },
      });
      mockPrisma.userFollow.findMany.mockResolvedValue([{ followerId: 'f1' }]);

      const result = await service.update('t1', { published: true }, 'u1');
      expect(result.published).toBe(true);
      expect(mockNotificationProducer.notify).toHaveBeenCalledWith(
        'thread_created',
        ['f1'],
        expect.any(String),
        expect.objectContaining({ threadId: 't1', fromUserId: 'u1' }),
      );
    });

    it('发布时无标题应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: false, title: '', category: 'DEDUCTION' });
      await expect(service.update('t1', { published: true }, 'u1')).rejects.toThrow(BusinessException);
    });

    it('发布时无子贴应拒绝', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: false, title: '测试', category: 'RPG' });
      mockPrisma.subthread.findFirst.mockResolvedValue(null);
      await expect(service.update('t1', { published: true }, 'u1')).rejects.toThrow(BusinessException);
    });

    it('已发布的帖不能再发布', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      mockPrisma.thread.findUnique.mockResolvedValue({ published: true, title: '测试', category: 'RPG' });
      await expect(service.update('t1', { published: true }, 'u1')).rejects.toThrow(BusinessException);
    });
  });

  describe('remove', () => {
    it('仅楼主可删除', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true });
      await expect(service.remove('t1', 'u2')).rejects.toThrow(BusinessException);
    });

    it('已发布帖软删除', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true });
      mockPrisma.thread.update.mockResolvedValue({ id: 't1', deletedAt: new Date() });
      const result = await service.remove('t1', 'u1');
      expect(result.deletedAt).toBeDefined();
      expect(mockPrisma.thread.update).toHaveBeenCalled();
    });

    it('未发布草稿硬删除', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: false });
      mockPrisma.thread.delete.mockResolvedValue({ id: 't1' });
      await service.remove('t1', 'u1');
      expect(mockPrisma.thread.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });
  });

  describe('assertCanManage', () => {
    it('OWNER 应该通过', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      await expect(service.assertCanManage('t1', 'u1')).resolves.toBeDefined();
    });

    it('COLLABORATOR 应该通过', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'COLLABORATOR' });
      await expect(service.assertCanManage('t1', 'u1')).resolves.toBeDefined();
    });

    it('PARTICIPANT 应该返回403', async () => {
      mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
      await expect(service.assertCanManage('t1', 'u1')).rejects.toThrow(BusinessException);
    });
  });

  describe('createInviteLink', () => {
    it('未发布帖禁止生成邀请链接', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: false, visibility: 'PRIVATE' });
      await expect(service.createInviteLink('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('公开帖禁止生成邀请链接', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true, visibility: 'PUBLIC' });
      await expect(service.createInviteLink('t1', 'u1')).rejects.toThrow(BusinessException);
    });

    it('私密已发布帖正常生成', async () => {
      mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', ownerId: 'u1', published: true, visibility: 'PRIVATE' });
      mockPrisma.threadInvite.upsert.mockResolvedValue({ id: 'inv1', threadId: 't1', token: 'abc123' });
      const result = await service.createInviteLink('t1', 'u1');
      expect(result.token).toBeDefined();
    });
  });

  describe('joinByInviteLink', () => {
    it('未发布帖禁止通过邀请加入', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1', thread: { id: 't1', visibility: 'PRIVATE', published: false },
      });
      await expect(service.joinByInviteLink('token123', 'u2')).rejects.toThrow(BusinessException);
    });

    it('已发布私密帖正常加入', async () => {
      mockPrisma.threadInvite.findUnique.mockResolvedValue({
        threadId: 't1', thread: { id: 't1', visibility: 'PRIVATE', published: true },
      });
      mockPrisma.threadMember.findUnique.mockResolvedValue(null);
      mockPrisma.threadMember.create.mockResolvedValue({ id: 'm1', thread: {}, user: {} });
      const result = await service.joinByInviteLink('token123', 'u2');
      expect(result.id).toBe('m1');
    });
  });
});
