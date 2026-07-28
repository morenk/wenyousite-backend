import { Test, TestingModule } from '@nestjs/testing';
import { ThreadMembersService } from './thread-members.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/exceptions/business.exception';

const mockPrisma = {
  thread: {
    findUnique: jest.fn(),
  },
  threadMember: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

describe('ThreadMembersService', () => {
  let service: ThreadMembersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadMembersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ThreadMembersService>(ThreadMembersService);
    jest.clearAllMocks();
  });

  it('私密帖应禁止自由加入', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PRIVATE' });
    await expect(service.join('t1', 'u1')).rejects.toThrow(BusinessException);
  });

  it('公开帖应允许自由加入', async () => {
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PUBLIC', published: true });
    mockPrisma.threadMember.findUnique.mockResolvedValue(null);
    mockPrisma.threadMember.create.mockResolvedValue({ id: 'm1' });
    const result = await service.join('t1', 'u1');
    expect(result.id).toBe('m1');
  });

  it('私密帖踢出仅取消玩家标记', async () => {
    mockPrisma.threadMember.findUnique
      .mockResolvedValueOnce({ role: 'OWNER' }) // assertCanManage: 操作者权限
      .mockResolvedValueOnce({ role: 'PARTICIPANT' }); // removeMember: 被踢者
    mockPrisma.thread.findUnique.mockResolvedValue({ id: 't1', visibility: 'PRIVATE' });
    mockPrisma.threadMember.update.mockResolvedValue({ id: 'm1', playerMarked: false });
    await service.removeMember('t1', 'u2', 'u1');
    expect(mockPrisma.threadMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { playerMarked: false } }),
    );
  });

  it('踢出应取消玩家标记', async () => {
    mockPrisma.threadMember.findUnique
      .mockResolvedValueOnce({ role: 'OWNER' }) // assertCanManage
      .mockResolvedValueOnce({ role: 'PARTICIPANT', playerMarked: true }); // removeMember
    mockPrisma.threadMember.update.mockResolvedValue({ id: 'm1', playerMarked: false });
    await service.removeMember('t1', 'u2', 'u1');
    expect(mockPrisma.threadMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { playerMarked: false } }),
    );
  });
});
