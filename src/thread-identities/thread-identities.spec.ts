import { ThreadIdentitiesService } from './thread-identities.service';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { MediaReferenceService } from '../media/media-reference.service';

describe('多角色身份边界', () => {
  function setup() {
    const rows = [
      {
        id: 'a',
        userId: 'u',
        threadId: 't',
        compatibilityIdentity: true,
        deletedAt: null as Date | null,
        nickname: '主角色',
        avatarMediaId: null,
        avatarMedia: null,
        version: 1,
        authorVersion: 1,
        profilePostId: null as string | null,
      },
      {
        id: 'b',
        userId: 'u',
        threadId: 't',
        compatibilityIdentity: false,
        deletedAt: null as Date | null,
        nickname: '主角色',
        avatarMediaId: null,
        avatarMedia: null,
        version: 1,
        authorVersion: 1,
        profilePostId: null as string | null,
      },
    ];
    const find = jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        rows.find((row) =>
          Object.entries(where).every(
            ([key, value]) => (row as Record<string, unknown>)[key] === value,
          ),
        ) ?? null,
      ),
    );
    const db = {
      thread: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ownerId: 'u', rpIdentityEnabled: true, rpIdentityVersion: 1 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u', username: '账号', avatar: null }),
      },
      threadMember: { findUnique: jest.fn().mockResolvedValue(null) },
      threadIdentity: { findFirst: find },
    };
    const service = new ThreadIdentitiesService(
      db as unknown as PrismaService,
      {} as ThreadAccessService,
      {} as MediaReferenceService,
    );
    return { service, rows, db };
  }
  it('同名角色仍有独立 token；修改 B 不使 A 草稿失效', async () => {
    const { service, rows } = setup();
    const a = await service.context('t', 'u', undefined, 'a');
    const b = await service.context('t', 'u', undefined, 'b');
    expect(a.token).not.toBe(b.token);
    rows[1].version++;
    rows[1].authorVersion++;
    rows[1].nickname = 'B改名';
    expect((await service.context('t', 'u', undefined, 'a')).token).toBe(a.token);
    expect((await service.context('t', 'u', undefined, 'b')).token).not.toBe(b.token);
  });
  it('只修改资料与资料版本不改变已签发作者 token', async () => {
    const { service, rows } = setup();
    const before = await service.context('t', 'u', undefined, 'a');
    rows[0].version++;
    rows[0].profilePostId = 'post';
    expect((await service.context('t', 'u', undefined, 'a')).token).toBe(before.token);
  });
  it('旧 single 只查兼容角色；归档后不选择剩余角色', async () => {
    const { service, rows } = setup();
    expect((await service.context('t', 'u')).display?.id).toBe('a');
    rows[0].deletedAt = new Date();
    expect((await service.context('t', 'u')).display).toBeNull();
    expect((await service.context('t', 'u', undefined, 'b')).display?.id).toBe('b');
  });
  it('删除或跨账号角色不可新发表，ACCOUNT 独立于任何角色状态', async () => {
    const { service, rows, db } = setup();
    rows[0].deletedAt = new Date();
    await expect(
      service.prepareAuthor(db as never, 't', 'u', 'stale', 'RP', 'a'),
    ).rejects.toMatchObject({ errorCode: 40011 });
    await expect(
      service.prepareAuthor(db as never, 't', 'u', 'stale', 'RP', 'other'),
    ).rejects.toMatchObject({ errorCode: 40011 });
    await expect(
      service.prepareAuthor(db as never, 't', 'u', 'stale', 'ACCOUNT', 'other'),
    ).resolves.toMatchObject({ identityCreateMode: 'ACCOUNT' });
  });
});
