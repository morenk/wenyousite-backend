import { Test, TestingModule } from '@nestjs/testing';
import { ThreadMembersService } from './thread-members.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';
import { OutboxService } from '../outbox/outbox.service';
import { ErrorCode } from '../common/exceptions/error-codes';

const mockPrisma = {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  thread: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  threadMember: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  subscription: { deleteMany: jest.fn() },
};
const mockOutbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

const mockThreadAccess = {
  assertAccessible: jest.fn().mockResolvedValue(undefined),
  assertCanManage: jest.fn().mockResolvedValue({ role: 'OWNER' }),
};

describe('ThreadMembersService', () => {
  let service: ThreadMembersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadMembersService,
        { provide: ThreadAccessService, useValue: mockThreadAccess },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OutboxService, useValue: mockOutbox },
      ],
    }).compile();
    service = module.get<ThreadMembersService>(ThreadMembersService);
    jest.clearAllMocks();
    mockThreadAccess.assertAccessible.mockResolvedValue(undefined);
    mockThreadAccess.assertCanManage.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'member' }]);
    mockPrisma.user.findUnique.mockResolvedValue({ username: '楼主' });
  });

  it('成员列表先校验主题帖访问权限', async () => {
    mockPrisma.threadMember.findMany.mockResolvedValue([]);
    await service.findAll('t1', 'u1');
    expect(mockThreadAccess.assertAccessible).toHaveBeenCalledWith('t1', 'u1');
  });

  it('私密帖禁止自由加入', async () => {
    mockThreadAccess.assertAccessible.mockRejectedValueOnce(
      new BusinessException(ErrorCode.THREAD_NOT_FOUND, '主题帖不存在', 404),
    );
    mockPrisma.thread.findUnique.mockResolvedValue({
      id: 't1',
      visibility: 'PRIVATE',
      published: true,
    });
    await expect(service.join('t1', 'u1')).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.thread.findUnique).not.toHaveBeenCalled();
  });

  it('公开帖兼容端点仍允许加入', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({
      id: 't1',
      visibility: 'PUBLIC',
      published: true,
    });
    mockPrisma.threadMember.findUnique.mockResolvedValue(null);
    mockPrisma.threadMember.create.mockResolvedValue({ id: 'm1' });
    await expect(service.join('t1', 'u1')).resolves.toMatchObject({ id: 'm1' });
  });

  it('协作者不能任免其他协作者', async () => {
    mockThreadAccess.assertCanManage.mockResolvedValue({ role: 'COLLABORATOR' });
    await expect(
      service.updateMember('t1', 'target', { role: 'COLLABORATOR' }, 'actor'),
    ).rejects.toThrow(BusinessException);
  });

  it('协作者可以管理玩家标记', async () => {
    mockThreadAccess.assertCanManage.mockResolvedValue({ role: 'COLLABORATOR' });
    mockPrisma.threadMember.findUnique.mockResolvedValue({
      id: 'member',
      role: 'PARTICIPANT',
      thread: { title: '协作主题' },
    });
    mockPrisma.threadMember.update.mockResolvedValue({ userId: 'target', playerMarked: true });

    await expect(
      service.updateMember('t1', 'target', { playerMarked: true }, 'actor'),
    ).resolves.toMatchObject({ playerMarked: true });
  });

  it('升为协作者时清理其持有和以其为目标的订阅', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({
      id: 'member',
      role: 'PARTICIPANT',
      thread: { title: '协作主题' },
    });
    mockPrisma.threadMember.update.mockResolvedValue({ userId: 'target', role: 'COLLABORATOR' });

    await service.updateMember('t1', 'target', { role: 'COLLABORATOR' }, 'owner');

    expect(mockPrisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: {
        threadId: 't1',
        OR: [{ userId: 'target' }, { type: 'USER', targetUserId: 'target' }],
      },
    });
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockOutbox.enqueue).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        eventType: 'thread.collaborator-role.changed',
        aggregateId: 'member',
        eventKey: expect.stringMatching(/^thread-collaborator-role:/),
        payload: expect.objectContaining({
          threadId: 't1',
          threadTitle: '协作主题',
          actorId: 'owner',
          actorName: '楼主',
          targetUserId: 'target',
          oldRole: 'PARTICIPANT',
          newRole: 'COLLABORATOR',
        }),
      }),
    );
  });

  it('收回玩家标记时清理以其为目标的 USER 订阅', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.threadMember.update.mockResolvedValue({ userId: 'target', playerMarked: false });

    await service.updateMember('t1', 'target', { playerMarked: false }, 'owner');

    expect(mockPrisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: { threadId: 't1', type: 'USER', targetUserId: 'target' },
    });
    expect(mockOutbox.enqueue).not.toHaveBeenCalled();
  });

  it('同角色重放不写事件，仅改玩家标记也不写事件', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({
      id: 'member',
      role: 'COLLABORATOR',
      playerMarked: false,
      thread: { title: '协作主题' },
    });
    mockPrisma.threadMember.update.mockResolvedValue({
      userId: 'target',
      role: 'COLLABORATOR',
      playerMarked: true,
    });

    await service.updateMember(
      't1',
      'target',
      { role: 'COLLABORATOR', playerMarked: true },
      'owner',
    );

    expect(mockOutbox.enqueue).not.toHaveBeenCalled();
  });

  it('角色与玩家标记同时修改时只写一次真实角色转换事件', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({
      id: 'member',
      role: 'COLLABORATOR',
      playerMarked: true,
      thread: { title: '协作主题' },
    });
    mockPrisma.threadMember.update.mockResolvedValue({
      userId: 'target',
      role: 'PARTICIPANT',
      playerMarked: false,
    });

    await service.updateMember(
      't1',
      'target',
      { role: 'PARTICIPANT', playerMarked: false },
      'owner',
    );

    expect(mockOutbox.enqueue).toHaveBeenCalledTimes(1);
    expect(mockOutbox.enqueue).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        payload: expect.objectContaining({
          oldRole: 'COLLABORATOR',
          newRole: 'PARTICIPANT',
        }),
      }),
    );
  });

  it('并发相同任命在行锁后重读新角色，只产生一条事件', async () => {
    mockPrisma.threadMember.findUnique
      .mockResolvedValueOnce({
        id: 'member',
        role: 'PARTICIPANT',
        thread: { title: '协作主题' },
      })
      .mockResolvedValueOnce({
        id: 'member',
        role: 'COLLABORATOR',
        thread: { title: '协作主题' },
      });
    mockPrisma.threadMember.update.mockResolvedValue({
      userId: 'target',
      role: 'COLLABORATOR',
    });

    await service.updateMember('t1', 'target', { role: 'COLLABORATOR' }, 'owner');
    await service.updateMember('t1', 'target', { role: 'COLLABORATOR' }, 'owner');

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockOutbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it('空更新应被拒绝', async () => {
    await expect(service.updateMember('t1', 'target', {}, 'owner')).rejects.toThrow(
      BusinessException,
    );
  });

  it('退出玩家身份同时清理目标订阅但保留成员', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({
      role: 'PARTICIPANT',
      playerMarked: true,
    });
    mockPrisma.threadMember.update.mockResolvedValue({ userId: 'u1', playerMarked: false });

    await service.exitMember('t1', 'u1');

    expect(mockPrisma.threadMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { playerMarked: false },
      }),
    );
    expect(mockPrisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: { threadId: 't1', type: 'USER', targetUserId: 'u1' },
    });
  });
});
