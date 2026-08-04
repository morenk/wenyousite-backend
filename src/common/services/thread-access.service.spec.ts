import { ThreadAccessService } from './thread-access.service';

const prisma = {
  thread: { findUnique: jest.fn() },
  threadMember: { findUnique: jest.fn() },
};

describe('ThreadAccessService', () => {
  let service: ThreadAccessService;

  beforeEach(() => {
    service = new ThreadAccessService(prisma as any);
    jest.clearAllMocks();
  });

  it('公开已发布主题帖允许匿名访问', async () => {
    prisma.thread.findUnique.mockResolvedValue({
      visibility: 'PUBLIC', published: true, ownerId: 'owner',
    });
    await expect(service.assertAccessible('t1')).resolves.toBeUndefined();
  });

  it('私密主题帖对非成员返回 404', async () => {
    prisma.thread.findUnique.mockResolvedValue({
      visibility: 'PRIVATE', published: true, ownerId: 'owner',
    });
    prisma.threadMember.findUnique.mockResolvedValue(null);
    await expect(service.assertAccessible('t1', 'outsider')).rejects.toMatchObject({ status: 404 });
  });

  it('管理权限会先拒绝已删除主题帖', async () => {
    prisma.thread.findUnique.mockResolvedValue(null);
    await expect(service.assertCanManage('deleted', 'collab')).rejects.toMatchObject({ status: 404 });
    expect(prisma.threadMember.findUnique).not.toHaveBeenCalled();
  });

  it('协作者可以通过管理权限校验', async () => {
    prisma.thread.findUnique.mockResolvedValue({
      visibility: 'PUBLIC', published: true, ownerId: 'owner',
    });
    prisma.threadMember.findUnique.mockResolvedValue({ role: 'COLLABORATOR' });
    await expect(service.assertCanManage('t1', 'collab')).resolves.toMatchObject({ role: 'COLLABORATOR' });
  });

  it('楼主专属校验拒绝协作者', async () => {
    prisma.thread.findUnique
      .mockResolvedValueOnce({ visibility: 'PUBLIC', published: true, ownerId: 'owner' })
      .mockResolvedValueOnce({ ownerId: 'owner' });
    await expect(service.assertOwner('t1', 'collab')).rejects.toMatchObject({ status: 403 });
  });
});
