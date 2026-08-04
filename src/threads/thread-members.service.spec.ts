import { Test, TestingModule } from '@nestjs/testing';
import { ThreadMembersService } from './thread-members.service';
import { ThreadAccessService } from '../common/services/thread-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';

const mockPrisma = {
  $transaction: jest.fn(),
  thread: { findUnique: jest.fn() },
  threadMember: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  subscription: { deleteMany: jest.fn() },
};

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
      ],
    }).compile();
    service = module.get<ThreadMembersService>(ThreadMembersService);
    jest.clearAllMocks();
    mockThreadAccess.assertAccessible.mockResolvedValue(undefined);
    mockThreadAccess.assertCanManage.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.$transaction.mockImplementation((callback) => callback({
      threadMember: mockPrisma.threadMember,
      subscription: mockPrisma.subscription,
    }));
  });

  it('成员列表先校验主题帖访问权限', async () => {
    mockPrisma.threadMember.findMany.mockResolvedValue([]);
    await service.findAll('t1', 'u1');
    expect(mockThreadAccess.assertAccessible).toHaveBeenCalledWith('t1', 'u1');
  });

  it('私密帖禁止自由加入', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PRIVATE', published: true });
    await expect(service.join('t1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('公开帖兼容端点仍允许加入', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PUBLIC', published: true });
    mockPrisma.threadMember.findUnique.mockResolvedValue(null);
    mockPrisma.threadMember.create.mockResolvedValue({ id: 'm1' });
    await expect(service.join('t1', 'u1')).resolves.toMatchObject({ id: 'm1' });
  });

  it('协作者不能任免其他协作者', async () => {
    mockThreadAccess.assertCanManage.mockResolvedValue({ role: 'COLLABORATOR' });
    await expect(service.updateMember('t1', 'target', { role: 'COLLABORATOR' }, 'actor'))
      .rejects.toThrow(BusinessException);
  });

  it('协作者可以管理玩家标记', async () => {
    mockThreadAccess.assertCanManage.mockResolvedValue({ role: 'COLLABORATOR' });
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.threadMember.update.mockResolvedValue({ userId: 'target', playerMarked: true });

    await expect(service.updateMember('t1', 'target', { playerMarked: true }, 'actor'))
      .resolves.toMatchObject({ playerMarked: true });
  });

  it('升为协作者时清理其持有和以其为目标的订阅', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.threadMember.update.mockResolvedValue({ userId: 'target', role: 'COLLABORATOR' });

    await service.updateMember('t1', 'target', { role: 'COLLABORATOR' }, 'owner');

    expect(mockPrisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: {
        threadId: 't1',
        OR: [{ userId: 'target' }, { type: 'USER', targetUserId: 'target' }],
      },
    });
  });

  it('收回玩家标记时清理以其为目标的 USER 订阅', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT' });
    mockPrisma.threadMember.update.mockResolvedValue({ userId: 'target', playerMarked: false });

    await service.updateMember('t1', 'target', { playerMarked: false }, 'owner');

    expect(mockPrisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: { threadId: 't1', type: 'USER', targetUserId: 'target' },
    });
  });

  it('空更新应被拒绝', async () => {
    await expect(service.updateMember('t1', 'target', {}, 'owner')).rejects.toThrow(BusinessException);
  });

  it('退出玩家身份同时清理目标订阅但保留成员', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'PARTICIPANT', playerMarked: true });
    mockPrisma.threadMember.update.mockResolvedValue({ userId: 'u1', playerMarked: false });

    await service.exitMember('t1', 'u1');

    expect(mockPrisma.threadMember.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { playerMarked: false },
    }));
    expect(mockPrisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: { threadId: 't1', type: 'USER', targetUserId: 'u1' },
    });
  });
});
