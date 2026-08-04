/** 子贴标签控制器测试：保证读写接口沿用当前用户执行帖子访问校验 */

import { SubthreadTagsController } from './subthread-tags.controller';

const mockPrisma = {
  subthreadTag: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  subthreadTagDef: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

const mockSubthreadsService = {
  findById: jest.fn(),
  assertCanManage: jest.fn(),
};

describe('SubthreadTagsController（帖子访问校验）', () => {
  let controller: SubthreadTagsController;

  beforeEach(() => {
    controller = new SubthreadTagsController(
      mockPrisma as never,
      mockSubthreadsService as never,
    );
    jest.clearAllMocks();
    mockSubthreadsService.findById.mockResolvedValue({
      id: 's1',
      threadId: 't1',
    });
    mockSubthreadsService.assertCanManage.mockResolvedValue(undefined);
  });

  it('匿名读取标签时仍校验主题帖可访问性', async () => {
    mockPrisma.subthreadTag.findMany.mockResolvedValue([]);

    await controller.findAll('s1', {} as never);

    expect(mockSubthreadsService.findById).toHaveBeenCalledWith(
      's1',
      undefined,
    );
    expect(mockPrisma.subthreadTag.findMany).toHaveBeenCalledWith({
      where: { subthreadId: 's1' },
      include: { tag: true },
    });
  });

  it('登录用户读取私密子贴标签时传递用户 ID', async () => {
    mockPrisma.subthreadTag.findMany.mockResolvedValue([]);

    await controller.findAll('s1', { user: { id: 'u1' } } as never);

    expect(mockSubthreadsService.findById).toHaveBeenCalledWith('s1', 'u1');
  });

  it('添加标签时以当前用户读取子贴后再校验管理权限', async () => {
    mockPrisma.subthreadTagDef.findFirst.mockResolvedValue({
      id: 'tag1',
      name: '设定',
    });
    mockPrisma.subthreadTag.upsert.mockResolvedValue({});

    await controller.add(
      's1',
      { name: '设定' },
      { user: { id: 'u1' } } as never,
    );

    expect(mockSubthreadsService.findById).toHaveBeenCalledWith('s1', 'u1');
    expect(mockSubthreadsService.assertCanManage).toHaveBeenCalledWith(
      't1',
      'u1',
    );
  });

  it('移除标签时以当前用户读取子贴后再校验管理权限', async () => {
    mockPrisma.subthreadTag.deleteMany.mockResolvedValue({ count: 1 });

    await controller.remove('s1', 'tag1', { user: { id: 'u1' } } as never);

    expect(mockSubthreadsService.findById).toHaveBeenCalledWith('s1', 'u1');
    expect(mockSubthreadsService.assertCanManage).toHaveBeenCalledWith(
      't1',
      'u1',
    );
  });
});
