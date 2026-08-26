import type { Prisma } from '@prisma/client';
import type { PostingPolicyService } from '../access/posting-policy.service';
import type { ThreadAccessService } from '../access/thread-access.service';
import { ErrorCode } from '../common/exceptions/error-codes';
import { lockAndValidatePostCreate } from './post-create-guard';

function buildContext() {
  const tx = {
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
    post: { findUnique: jest.fn() },
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
