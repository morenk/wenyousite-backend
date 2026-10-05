import { identityToken } from '../thread-identities/identity-policy';
import type { Prisma } from '@prisma/client';
import type { PostingPolicyService } from '../access/posting-policy.service';
import type { ThreadAccessService } from '../access/thread-access.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { assertSamePostCreateRequest, lockAndValidatePostCreate } from './post-create-guard';

function buildContext() {
  const tx = {
    thread: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) },
    userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    subthread: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'subthread-1',
        title: '主线',
        postingPolicy: 'PARTICIPANTS',
        threadId: 'thread-1',
        thread: { ownerId: 'owner-1', published: true },
      }),
    },
    threadMember: {
      findUnique: jest.fn().mockResolvedValue({
        role: 'PARTICIPANT',
        playerMarked: false,
      }),
    },
    post: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  };
  const threadAccess = { assertAccessible: jest.fn().mockResolvedValue(undefined) };
  const postingPolicy = { assertCanPost: jest.fn().mockResolvedValue(undefined) };
  return { tx, threadAccess, postingPolicy };
}

describe('lockAndValidatePostCreate 回复父级不变量', () => {
  it('replyToPostId 缺少 parentPostId 时在加锁前拒绝', async () => {
    const { tx, threadAccess, postingPolicy } = buildContext();

    await expect(
      lockAndValidatePostCreate(
        tx as unknown as Prisma.TransactionClient,
        threadAccess as unknown as ThreadAccessService,
        postingPolicy as unknown as PostingPolicyService,
        {
          threadId: 'thread-1',
          subthreadId: 'subthread-1',
          userId: 'user-1',
          replyToPostId: 'reply-1',
        },
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST, status: 400 });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('拒绝同一子贴内属于另一主楼层的目标', async () => {
    const { tx, threadAccess, postingPolicy } = buildContext();
    tx.post.findUnique
      .mockResolvedValueOnce({
        id: 'root-1',
        subthreadId: 'subthread-1',
        parentPostId: null,
        authorId: 'floor-author',
        author: { username: '楼层作者' },
      })
      .mockResolvedValueOnce({
        id: 'reply-2',
        subthreadId: 'subthread-1',
        parentPostId: 'root-2',
        authorId: 'reply-author',
        author: { username: '回复作者' },
        parentPost: { deletedAt: null },
      });

    await expect(
      lockAndValidatePostCreate(
        tx as unknown as Prisma.TransactionClient,
        threadAccess as unknown as ThreadAccessService,
        postingPolicy as unknown as PostingPolicyService,
        {
          threadId: 'thread-1',
          subthreadId: 'subthread-1',
          userId: 'user-1',
          parentPostId: 'root-1',
          replyToPostId: 'reply-2',
        },
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST, status: 400 });
  });

  it('允许目标为同一父楼下的回复并返回事务快照', async () => {
    const { tx, threadAccess, postingPolicy } = buildContext();
    tx.post.findUnique
      .mockResolvedValueOnce({
        id: 'root-1',
        subthreadId: 'subthread-1',
        parentPostId: null,
        authorId: 'floor-author',
        author: { username: '楼层作者' },
      })
      .mockResolvedValueOnce({
        id: 'reply-1',
        subthreadId: 'subthread-1',
        parentPostId: 'root-1',
        authorId: 'reply-author',
        author: { username: '回复作者' },
        parentPost: { deletedAt: null },
      });

    const result = await lockAndValidatePostCreate(
      tx as unknown as Prisma.TransactionClient,
      threadAccess as unknown as ThreadAccessService,
      postingPolicy as unknown as PostingPolicyService,
      {
        threadId: 'thread-1',
        subthreadId: 'subthread-1',
        userId: 'user-1',
        parentPostId: 'root-1',
        replyToPostId: 'reply-1',
      },
    );

    expect(result.replyTarget).toMatchObject({
      id: 'reply-1',
      authorId: 'reply-author',
      author: { username: '回复作者' },
    });
  });
});


describe('创建请求身份模式幂等性', () => {
  const post = { subthreadId: 'sub', content: '正文', parentPostId: null, replyToPostId: null };
  it('旧记录继续接受缺省 mode，显式 ACCOUNT 与缺省不能复用幂等键', () => {
    expect(() => assertSamePostCreateRequest(post, 'sub', { content: '正文' }, '正文')).not.toThrow();
    expect(() => assertSamePostCreateRequest(post, 'sub', { content: '正文', identityMode: 'ACCOUNT' }, '正文')).toThrow();
  });
  it('服务升级后补能力6不改变旧普通正文的幂等回放', () => {
    expect(() => assertSamePostCreateRequest(post, 'sub', {content:'正文',markdownContractVersion:6}, '正文')).not.toThrow();
    const account = {...post,identityCreateMode:'ACCOUNT',identityRequestHash:identityToken([null,null])};
    expect(() => assertSamePostCreateRequest(account, 'sub', {content:'正文',identityMode:'ACCOUNT',markdownContractVersion:6}, '正文')).not.toThrow();
  });
  it('重复请求 mode 固定，token 更新不影响已成功创建记录', () => {
    const rpPost = { ...post, identityCreateMode: 'RP' };
    expect(() => assertSamePostCreateRequest(rpPost, 'sub', { content: '正文', identityMode: 'RP', identityToken: 'old' }, '正文')).not.toThrow();
    expect(() => assertSamePostCreateRequest(rpPost, 'sub', { content: '正文', identityMode: 'ACCOUNT' }, '正文')).toThrow();
  });
});

describe('角色选择的幂等载荷', () => {
  const post = {
    subthreadId: 's',
    content: '正文',
    parentPostId: null,
    replyToPostId: null,
    identityCreateMode: 'RP',
    identityRequestHash: identityToken(['a', 'token-a']),
  };
  const dto = {
    content: '正文',
    identityMode: 'RP' as const,
    identityId: 'a',
    identityToken: 'token-a',
  };
  it('原 ID/token 的超时重试保持同一发言', () =>
    expect(() => assertSamePostCreateRequest(post, 's', dto, '正文')).not.toThrow());
  it.each([
    { identityId: 'b' },
    { identityToken: 'new-token' },
    { identityMode: 'ACCOUNT' as const },
  ])('更换身份选择不能复用请求键 %s', (change) => {
    expect(() => assertSamePostCreateRequest(post, 's', { ...dto, ...change }, '正文')).toThrow();
  });
  it('迁移前无指纹旧记录仅允许无角色ID的旧重试', () => {
    const old = { ...post, identityRequestHash: null };
    expect(() =>
      assertSamePostCreateRequest(old, 's', { content: '正文', identityMode: 'RP' }, '正文'),
    ).not.toThrow();
    expect(() => assertSamePostCreateRequest(old, 's', dto, '正文')).toThrow();
  });
});
