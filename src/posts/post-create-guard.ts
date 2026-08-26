import { Prisma } from '@prisma/client';
import { PostingPolicyService } from '../access/posting-policy.service';
import { ThreadAccessService } from '../access/thread-access.service';
import { BusinessException, notFound } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';

interface PostCreateContext {
  threadId: string;
  subthreadId: string;
  userId: string;
  parentPostId?: string;
  replyToPostId?: string;
}

/** 获取内容聚合锁，并在同一事务快照内复核所有发帖父级和权限。 */
export async function lockAndValidatePostCreate(
  tx: Prisma.TransactionClient,
  threadAccess: ThreadAccessService,
  postingPolicy: PostingPolicyService,
  context: PostCreateContext,
) {
  const { threadId, subthreadId, userId, parentPostId, replyToPostId } = context;
  if (replyToPostId && !parentPostId) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '指定回复目标时必须同时指定父楼层');
  }
  await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
  await threadAccess.assertAccessible(threadId, userId, tx);
  const subthread = await tx.subthread.findUnique({
    where: { id: subthreadId, deletedAt: null },
    select: {
      id: true,
      title: true,
      postingPolicy: true,
      threadId: true,
      thread: { select: { ownerId: true, published: true } },
    },
  });
  if (!subthread) throw notFound(ErrorCode.SUBTHREAD_NOT_FOUND, '子贴不存在');

  const member = await tx.threadMember.findUnique({
    where: { threadId_userId: { threadId, userId } },
  });
  await postingPolicy.assertCanPost({
    ownerId: subthread.thread.ownerId,
    userId,
    postingPolicy: subthread.postingPolicy,
    member,
  });

  let parent: {
    id: string;
    subthreadId: string;
    parentPostId: string | null;
    authorId: string;
    author: { username: string };
  } | null = null;
  if (parentPostId) {
    parent = await tx.post.findUnique({
      where: { id: parentPostId, deletedAt: null },
      select: {
        id: true,
        subthreadId: true,
        parentPostId: true,
        authorId: true,
        author: { select: { username: true } },
      },
    });
    if (!parent) throw notFound(ErrorCode.POST_NOT_FOUND, '父楼层不存在');
    if (parent.subthreadId !== subthreadId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能跨子贴回复');
    }
    if (parent.parentPostId !== null) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '只能回复主楼层');
    }
  }

  let replyTarget = parent;
  if (replyToPostId) {
    const target = await tx.post.findUnique({
      where: { id: replyToPostId, deletedAt: null },
      select: {
        id: true,
        subthreadId: true,
        parentPostId: true,
        authorId: true,
        author: { select: { username: true } },
        parentPost: { select: { deletedAt: true } },
      },
    });
    if (!target || target.parentPost?.deletedAt) {
      throw notFound(ErrorCode.POST_NOT_FOUND, '被回复的帖子不存在');
    }
    if (target.subthreadId !== subthreadId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能跨子贴回复');
    }
    if ((target.parentPostId ?? target.id) !== parentPostId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '回复目标必须属于同一主楼层');
    }
    replyTarget = target;
  }

  return { subthread, member, replyTarget };
}
