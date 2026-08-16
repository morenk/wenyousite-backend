import { Test, TestingModule } from '@nestjs/testing';
import { MentionsService } from './mentions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { BlockFilterService } from '../access/block-filter.service';

const mockPrisma = {
  $transaction: jest.fn(),
  user: {
    findMany: jest.fn(),
  },
  postMention: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  userFollow: {
    findMany: jest.fn(),
  },
  userBlock: {
    findMany: jest.fn(),
  },
};

describe('MentionsService', () => {
  let service: MentionsService;
  const mockThreadAccess = { assertAccessible: jest.fn().mockResolvedValue(undefined) };
  const mockBlockFilter = {
    loadBlockSets: jest.fn().mockResolvedValue({ blockedByUser: new Set(), blockedByAuthor: new Set() }),
    filterRecipients: jest.fn((ids: string[]) => ids),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MentionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ThreadAccessService, useValue: mockThreadAccess },
        { provide: BlockFilterService, useValue: mockBlockFilter },
      ],
    }).compile();
    service = module.get<MentionsService>(MentionsService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (client: typeof mockPrisma) => unknown) => callback(mockPrisma),
    );
  });

  it('应该提取 @用户名', () => {
    const names = service.extractUsernames('你好 @张三 和 @李四，还有 @john_doe');
    expect(names).toContain('张三');
    expect(names).toContain('李四');
    expect(names).toContain('john_doe');
  });

  it('重复的 @用户名 应该去重', () => {
    const names = service.extractUsernames('@张三 你好 @张三 又见面了');
    expect(names.filter((n) => n === '张三')).toHaveLength(1);
  });

  it('邮箱和单词内部的 @ 不应被解析为历史提及', () => {
    expect(service.extractUsernames('mail@test.example foo@李四，真正提及 @张三')).toEqual(['张三']);
  });

  it('围栏代码块和成对行内代码中的提及不应触发解析', async () => {
    mockPrisma.postMention.deleteMany.mockResolvedValue({ count: 0 });
    const content = [
      '````md',
      '```',
      '[@围栏用户](/users/u2) @全体玩家',
      '```',
      '````',
      '~~~md',
      '@波浪用户',
      '~~~',
      '正文中的 ``[@行内用户](/users/u3) @全体玩家``',
    ].join('\n');

    const result = await service.syncMentions('p1', content, 'u1', 't1');

    expect(result).toEqual([]);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.threadMember.findUnique).not.toHaveBeenCalled();
  });

  it('稳定链接应按 userId 查找，不依赖显示标签中的旧用户名', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u2', username: '新名字', avatar: null }]);
    mockPrisma.postMention.findMany.mockResolvedValue([]);
    mockPrisma.userFollow.findMany.mockResolvedValue([{ followingId: 'u2' }]);
    mockPrisma.threadMember.findMany.mockResolvedValue([]);
    mockPrisma.postMention.createMany.mockResolvedValue({});

    const result = await service.syncMentions(
      'p1',
      '你好 [@旧名字](/users/u2)',
      'u1',
      't1',
    );

    expect(result).toEqual([{ userId: 'u2', username: '新名字', source: 'DIRECT' }]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { OR: [{ id: { in: ['u2'] } }], deletedAt: null },
      select: { id: true, username: true, avatar: true },
    });
  });

  it('parseAndCreate 应该创建 PostMention 记录', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u2', username: '张三' },
      { id: 'u3', username: '李四' },
    ]);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.userFollow.findMany.mockResolvedValue([]);
    mockPrisma.threadMember.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }]);
    mockPrisma.postMention.findMany.mockResolvedValue([]);
    mockPrisma.postMention.createMany.mockResolvedValue({});
    const result = await service.parseAndCreate('p1', '你好 @张三 和 @李四', 'u1', 't1');
    expect(result).toHaveLength(2);
  });

  it('@自己 不应该创建通知', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', username: '张三' }]);
    const result = await service.parseAndCreate('p1', '你好 @张三', 'u1', 't1');
    expect(result).toHaveLength(0);
  });

  it('普通角色不能越过关注和 playerMarked 范围', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u2', username: '张三' },
      { id: 'u3', username: '李四' },
    ]);
    mockPrisma.postMention.findMany.mockResolvedValue([]);
    mockPrisma.userFollow.findMany.mockResolvedValue([{ followingId: 'u2' }]);
    mockPrisma.threadMember.findMany.mockResolvedValue([]);
    mockPrisma.postMention.createMany.mockResolvedValue({});

    const result = await service.parseAndCreate('p1', '@张三 @李四', 'u1', 't1');
    expect(result.map((item) => item.userId)).toEqual(['u2']);
  });

  it('只有楼主/协作者可以用 @全体玩家，且只快照 playerMarked 用户', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.postMention.findMany.mockResolvedValue([]);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'COLLABORATOR' });
    mockPrisma.threadMember.findMany.mockResolvedValue([
      { user: { id: 'u2', username: '张三', avatar: null } },
      { user: { id: 'u3', username: '李四', avatar: null } },
    ]);
    mockPrisma.postMention.createMany.mockResolvedValue({});

    const result = await service.parseAndCreate('p1', '@全体玩家', 'u1', 't1');
    expect(result.map((item) => item.userId)).toEqual(['u2', 'u3']);
    expect(mockPrisma.postMention.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ source: 'ALL_PLAYERS' }),
      ]),
    }));
  });

  it('canMentionAllPlayers 应按主题帖和用户判断楼主/协作者权限', async () => {
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });

    await expect(service.canMentionAllPlayers('t1', 'u1')).resolves.toBe(true);
    expect(mockPrisma.threadMember.findUnique).toHaveBeenCalledWith({
      where: { threadId_userId: { threadId: 't1', userId: 'u1' } },
      select: { role: true },
    });
  });

  it('无 @ 的正文应该返回空', async () => {
    const result = await service.parseAndCreate('p1', '普通内容没有提及', 'u1', 't1');
    expect(result).toHaveLength(0);
  });

  it('编辑删除最后一个提及时应清空该帖全部提及快照', async () => {
    mockPrisma.postMention.deleteMany.mockResolvedValue({ count: 2 });

    const result = await service.syncMentions(
      'p1',
      '已经没有任何提及',
      'u1',
      't1',
      '[@张三](/users/u2) @全体玩家',
    );

    expect(result).toEqual([]);
    expect(mockPrisma.postMention.deleteMany).toHaveBeenCalledWith({
      where: { postId: 'p1' },
    });
    expect(mockPrisma.postMention.findMany).not.toHaveBeenCalled();
  });

  it('事务同步应复用调用者客户端并保留全体玩家快照', async () => {
    const transactionClient = {
      ...mockPrisma,
      postMention: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'mention-1',
            mentionedUserId: 'u2',
            source: 'ALL_PLAYERS',
            mentionedUser: { id: 'u2', username: '张三', avatar: null },
          },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });

    const result = await service.syncMentionsInTransaction(
      transactionClient,
      'p1',
      '@全体玩家 更新',
      'u1',
      't1',
      '@全体玩家 旧正文',
    );

    expect(result).toEqual([]);
    expect(transactionClient.postMention.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { postId: 'p1' } }),
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(transactionClient.threadMember.findMany).not.toHaveBeenCalled();
  });

  it('缺少 threadId 时不应清空提及快照', async () => {
    const result = await service.syncMentions('p1', '已经没有任何提及', 'u1');

    expect(result).toEqual([]);
    expect(mockPrisma.postMention.deleteMany).not.toHaveBeenCalled();
  });

  it('私密帖不可访问时不应解析提及', async () => {
    mockThreadAccess.assertAccessible.mockRejectedValueOnce(new Error('not found'));
    await expect(service.parseAndCreate('p1', '@张三', 'u1', 'private-thread')).rejects.toThrow('not found');
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('候选接口应过滤双向拉黑用户', async () => {
    mockPrisma.userFollow.findMany.mockResolvedValue([
      { following: { id: 'u2', username: '张三', avatar: null } },
      { following: { id: 'u3', username: '李四', avatar: null } },
    ]);
    mockPrisma.threadMember.findMany.mockResolvedValue([]);
    mockBlockFilter.loadBlockSets.mockResolvedValueOnce({
      blockedByUser: new Set(['u2']),
      blockedByAuthor: new Set(),
    });
    mockBlockFilter.filterRecipients.mockImplementationOnce((ids: string[]) =>
      ids.filter((id) => id !== 'u2'),
    );

    const result = await service.findCandidates('t1', 'u1');
    expect(result.map((candidate) => candidate.id)).toEqual(['u3']);
  });
});
