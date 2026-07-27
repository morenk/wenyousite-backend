import { Test, TestingModule } from '@nestjs/testing';
import { MentionsService } from './mentions.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findMany: jest.fn(),
  },
  postMention: {
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  threadMember: {
    findUnique: jest.fn(),
  },
  userFollow: {
    findMany: jest.fn(),
  },
};

describe('MentionsService', () => {
  let service: MentionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MentionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<MentionsService>(MentionsService);
    jest.clearAllMocks();
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

  it('parseAndCreate 应该创建 PostMention 记录', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u2', username: '张三' },
      { id: 'u3', username: '李四' },
    ]);
    mockPrisma.threadMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    mockPrisma.userFollow.findMany.mockResolvedValue([]);
    mockPrisma.postMention.createMany.mockResolvedValue({});
    const result = await service.parseAndCreate('p1', '你好 @张三 和 @李四', 'u1', 't1');
    expect(result).toHaveLength(2);
  });

  it('@自己 不应该创建通知', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1', username: '张三' }]);
    const result = await service.parseAndCreate('p1', '你好 @张三', 'u1', 't1');
    expect(result).toHaveLength(0);
  });

  it('无 @ 的正文应该返回空', async () => {
    const result = await service.parseAndCreate('p1', '普通内容没有提及', 'u1', 't1');
    expect(result).toHaveLength(0);
  });
});
