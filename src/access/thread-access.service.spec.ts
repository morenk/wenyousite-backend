import { ThreadAccessService } from './thread-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/exceptions/error-codes';

const prisma = {
  thread: { findUnique: jest.fn() },
  threadMember: { findUnique: jest.fn() },
};

describe('ThreadAccessService', () => {
  let service: ThreadAccessService;

  beforeEach(() => {
    service = new ThreadAccessService(prisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  it.each([
    {
      label: '不存在的主题',
      thread: null,
      member: null,
      userId: 'viewer',
      allowed: false,
    },
    {
      label: 'PRIVATE 主题非成员',
      thread: { visibility: 'PRIVATE', published: true, ownerId: 'owner' },
      member: null,
      userId: 'outsider',
      allowed: false,
    },
    {
      label: 'PRIVATE 主题成员',
      thread: { visibility: 'PRIVATE', published: true, ownerId: 'owner' },
      member: { role: 'PARTICIPANT' },
      userId: 'member',
      allowed: true,
    },
    {
      label: 'PUBLIC 主题非楼主',
      thread: { visibility: 'PUBLIC', published: true, ownerId: 'owner' },
      member: null,
      userId: 'viewer',
      allowed: true,
    },
    {
      label: '草稿楼主',
      thread: { visibility: 'PRIVATE', published: false, ownerId: 'owner' },
      member: null,
      userId: 'owner',
      allowed: true,
    },
    {
      label: '草稿非楼主',
      thread: { visibility: 'PUBLIC', published: false, ownerId: 'owner' },
      member: null,
      userId: 'viewer',
      allowed: false,
    },
  ])('$label 的统一访问结果符合存在性边界', async ({ thread, member, userId, allowed }) => {
    prisma.thread.findUnique.mockResolvedValue(thread);
    prisma.threadMember.findUnique.mockResolvedValue(member);

    const access = service.assertAccessible('t1', userId);
    if (allowed) {
      await expect(access).resolves.toBeUndefined();
    } else {
      await expect(access).rejects.toMatchObject({
        status: 404,
        errorCode: ErrorCode.THREAD_NOT_FOUND,
      });
    }
  });

  it('批量通知收件人只保留私密主题当前成员', async () => {
    prisma.thread.findUnique.mockResolvedValue({
      visibility: 'PRIVATE',
      published: true,
      ownerId: 'owner',
      members: [{ userId: 'member' }],
    });

    await expect(
      service.filterAccessibleUserIds('t1', ['member', 'follower', 'member']),
    ).resolves.toEqual(['member']);
  });

  it('删除主题不允许产生任何新通知', async () => {
    prisma.thread.findUnique.mockResolvedValue(null);
    await expect(service.filterAccessibleUserIds('deleted', ['member'])).resolves.toEqual([]);
  });

  it('管理权限会先拒绝已删除主题帖', async () => {
    prisma.thread.findUnique.mockResolvedValue(null);
    await expect(service.assertCanManage('deleted', 'collab')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.threadMember.findUnique).not.toHaveBeenCalled();
  });

  it('协作者可以通过管理权限校验', async () => {
    prisma.thread.findUnique.mockResolvedValue({
      visibility: 'PUBLIC',
      published: true,
      ownerId: 'owner',
    });
    prisma.threadMember.findUnique.mockResolvedValue({ role: 'COLLABORATOR' });
    await expect(service.assertCanManage('t1', 'collab')).resolves.toMatchObject({
      role: 'COLLABORATOR',
    });
  });

  it('楼主专属校验拒绝协作者', async () => {
    prisma.thread.findUnique.mockResolvedValue({ visibility: 'PUBLIC', ownerId: 'owner' });
    await expect(service.assertOwner('t1', 'collab')).rejects.toMatchObject({ status: 403 });
  });

  it('楼主专属入口对私密帖非楼主隐藏存在性', async () => {
    prisma.thread.findUnique.mockResolvedValue({ visibility: 'PRIVATE', ownerId: 'owner' });
    await expect(service.assertOwner('t1', 'outsider')).rejects.toMatchObject({ status: 404 });
  });
});
