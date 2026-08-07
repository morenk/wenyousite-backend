import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { ThreadTagsService } from './thread-tags.service';

describe('ThreadTagsService', () => {
  const prisma = {
    threadTopicTag: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const tags = { findOrCreate: jest.fn() };
  const access = { assertAccessible: jest.fn(), assertCanManage: jest.fn() };
  let service: ThreadTagsService;

  beforeEach(() => {
    jest.clearAllMocks();
    access.assertAccessible.mockResolvedValue(undefined);
    access.assertCanManage.mockResolvedValue(undefined);
    service = new ThreadTagsService(
      prisma as unknown as PrismaService,
      tags as unknown as TagsService,
      access as unknown as ThreadAccessService,
    );
  });

  it('校验可访问性后读取主题标签', async () => {
    prisma.threadTopicTag.findMany.mockResolvedValue([{ tag: { id: 'tag-1', name: 'RPG' } }]);

    await expect(service.findAll('thread-1', 'viewer-1')).resolves.toEqual([
      { tag: { id: 'tag-1', name: 'RPG' } },
    ]);
    expect(access.assertAccessible).toHaveBeenCalledWith('thread-1', 'viewer-1');
    expect(prisma.threadTopicTag.findMany).toHaveBeenCalledWith({
      where: { threadId: 'thread-1' },
      include: { tag: true },
    });
  });

  it('无管理权限时不创建标签关联', async () => {
    access.assertCanManage.mockRejectedValue(new Error('forbidden'));

    await expect(service.add('thread-1', 'RPG', 'viewer-1')).rejects.toThrow('forbidden');
    expect(tags.findOrCreate).not.toHaveBeenCalled();
    expect(prisma.threadTopicTag.upsert).not.toHaveBeenCalled();
  });

  it('复用平台标签并幂等关联到主题', async () => {
    const tag = { id: 'tag-1', name: 'RPG' };
    tags.findOrCreate.mockResolvedValue([tag]);
    prisma.threadTopicTag.upsert.mockResolvedValue({});

    await expect(service.add('thread-1', 'RPG', 'owner-1')).resolves.toBe(tag);
    expect(access.assertCanManage).toHaveBeenCalledWith('thread-1', 'owner-1');
    expect(tags.findOrCreate).toHaveBeenCalledWith(['RPG']);
    expect(prisma.threadTopicTag.upsert).toHaveBeenCalledWith({
      where: { threadId_tagId: { threadId: 'thread-1', tagId: 'tag-1' } },
      create: { threadId: 'thread-1', tagId: 'tag-1' },
      update: {},
    });
  });

  it('校验管理权限后删除标签关联', async () => {
    prisma.threadTopicTag.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remove('thread-1', 'tag-1', 'owner-1')).resolves.toEqual({
      message: '标签已移除',
    });
    expect(access.assertCanManage).toHaveBeenCalledWith('thread-1', 'owner-1');
    expect(prisma.threadTopicTag.deleteMany).toHaveBeenCalledWith({
      where: { threadId: 'thread-1', tagId: 'tag-1' },
    });
  });
});
