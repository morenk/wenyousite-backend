import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ThreadIdentitiesService } from './thread-identities.service';
import { UpdateRpIdentityDto } from './thread-identity.dto';
import { visiblePostWhere } from '../access/block-visibility.where';
import { identityToken } from './identity-policy';

function setup() {
  const row = { id: 'role', threadId: 'thread', userId: 'owner', nickname: '白鸦', avatarMediaId: null,
    avatarMedia: null, profilePostId: 'post' as string | null, version: 7, authorVersion: 7,
    deletedAt: null as Date | null, compatibilityIdentity: true };
  const thread = { ownerId: 'owner', rpIdentityEnabled: true, rpIdentityVersion: 2 };
  const db = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    thread: { findUnique: jest.fn().mockResolvedValue(thread) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'owner', username: '账号', avatar: null }),
      findFirst: jest.fn().mockResolvedValue({ id: 'owner' }) },
    threadMember: { findUnique: jest.fn().mockResolvedValue(null) },
    post: { findFirst: jest.fn().mockResolvedValue({ id: 'post' }) },
    threadIdentity: {
      findFirst: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        if (data.profilePostId !== undefined) row.profilePostId = data.profilePostId as string | null;
        if (data.nickname !== undefined) row.nickname = data.nickname as string;
        row.version++;
        if (data.authorVersion) row.authorVersion++;
        return Promise.resolve(row);
      }),
    },
    threadIdentityAlias: { upsert: jest.fn() },
  };
  db.$transaction.mockImplementation((fn: (value: unknown) => unknown) => fn(db));
  const service = new ThreadIdentitiesService(db as never, { assertAccessible: jest.fn() } as never,
    { reconcileMediaIds: jest.fn() } as never);
  return { row, thread, db, service };
}

describe('角色资料引用', () => {
  it('旧作者版本迁移保持 token 输入，新增 profile 不加入历史快照', async () => {
    const { service } = setup();
    const current = await service.context('thread', 'owner', undefined, 'role');
    expect(current.token).toBe(identityToken(['thread', 'owner', true, 2, true, 'role', 7,
      current.display, null, null]));
    expect(current.display).not.toHaveProperty('profilePostId');
  });
  it('保存资料使用可见性策略且不改变作者 token，昵称改变仍失效', async () => {
    const { service, db } = setup();
    const before = await service.context('thread', 'owner', undefined, 'role');
    const result = await service.update('thread', 'owner', { profilePostId: 'new-post', version: 7 }, 'role');
    expect(result.identity?.version).toBe(8);
    expect(result.identityToken).toBe(before.token);
    expect(db.post.findFirst).toHaveBeenCalledWith({ where: { id: 'new-post', threadId: 'thread', ...visiblePostWhere('owner') }, select: { id: true } });
    const renamed = await service.update('thread', 'owner', { nickname: '黑鸦', version: 8 }, 'role');
    expect(renamed.identity?.profilePostId).toBe('new-post');
    expect(renamed.identityToken).not.toBe(before.token);
  });
  it('null 和显式 flag 均解绑，旧 clear 省略资料字段保留原绑定', async () => {
    const { service, row } = setup();
    await service.update('thread', 'owner', { clearProfilePost: true, version: 7 }, 'role');
    expect(row.profilePostId).toBeNull();
    row.profilePostId = 'post';
    await service.update('thread', 'owner', { profilePostId: null, version: 8 }, 'role');
    expect(row.profilePostId).toBeNull();
    row.profilePostId = 'post';
    const result = await service.update('thread', 'owner', { nickname: null, avatarMediaId: null });
    expect(row.profilePostId).toBe('post');
    expect(result.profilePostStatus).toBe('NONE');
    expect(result.profilePostId).toBeNull();
  });
  it('不可读目标不泄露 ID/原因；本人原绑定保留，关闭隐藏整个资料区域', async () => {
    const { service, db, thread } = setup();
    db.post.findFirst.mockResolvedValue(null);
    const own = await service.role('thread', 'role', 'owner');
    expect(own).toMatchObject({ profilePostStatus: 'UNAVAILABLE', profilePostId: null, identity: { profilePostId: 'post' } });
    const other = await service.role('thread', 'role', 'reader');
    expect(other).toMatchObject({ profilePostStatus: 'UNAVAILABLE', profilePostId: null, identity: null });
    thread.rpIdentityEnabled = false;
    expect(await service.role('thread', 'role', 'reader')).toMatchObject({ profilePostStatus: 'NONE', profilePostId: null });
  });
  it('跨主题/隐藏目标、过期版本、清除冲突均不写入', async () => {
    const { service, db } = setup();
    db.post.findFirst.mockResolvedValue(null);
    await expect(service.update('thread', 'owner', { profilePostId: 'unavailable', version: 7 }, 'role')).rejects.toMatchObject({ errorCode: 40403 });
    await expect(service.update('thread', 'owner', { clearProfilePost: true, version: 6 }, 'role')).rejects.toMatchObject({ errorCode: 40002 });
    await expect(service.update('thread', 'owner', { profilePostId: 'post', clearProfilePost: true, version: 7 }, 'role')).rejects.toMatchObject({ errorCode: 40001 });
    expect(db.threadIdentity.update).not.toHaveBeenCalled();
  });
  it('资料-only 创建不赋予空身份 RP 资格', async () => {
    const { service } = setup();
    await expect(service.update('thread', 'owner', { profilePostId: 'post' }, undefined, true)).rejects.toMatchObject({ errorCode: 40001 });
  });
  it('DTO 接受 null 和 clear flag，拒绝 URL', async () => {
    expect(await validate(plainToInstance(UpdateRpIdentityDto, { profilePostId: null, version: 1 }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateRpIdentityDto, { clearProfilePost: true, version: 1 }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateRpIdentityDto, { profilePostId: 'https://other.invalid/post', version: 1 }))).not.toEqual([]);
  });
});
