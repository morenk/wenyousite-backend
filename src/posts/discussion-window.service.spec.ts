import { Prisma } from '@prisma/client';
import { ReplyOrder } from '../common/dto/reply-query.dto';
import { ErrorCode } from '../common/exceptions/error-codes';
import { decodeDiscussionCursor, encodeDiscussionCursor } from './discussion-cursor';
import { DiscussionWindowService } from './discussion-window.service';

const secret = 'discussion-window-unit-test-secret';
const cursorContext = {
  scope: 'replies' as const,
  scopeId: 'root',
  order: ReplyOrder.OLDEST,
  authorId: null,
  viewerId: 'viewer',
};
function ref(id: string, number: number) {
  return { id, floorNumber: number, replyNumber: number };
}
function setup() {
  const tx = {
    post: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _count: 3, _max: { floorNumber: 9, replyNumber: 9 } }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = { $transaction: jest.fn(async (run: (client: typeof tx) => unknown) => run(tx)) };
  const parent = { threadId: 'thread', thread: { ownerId: 'owner' } };
  const queries = {
    findSubthreadContext: jest.fn().mockResolvedValue(parent),
    findDiscussionRoot: jest.fn().mockResolvedValue(parent),
    isEligibleDiscussionAuthor: jest.fn().mockResolvedValue(true),
  };
  const service = new DiscussionWindowService(
    prisma as never,
    queries as never,
    { getOrThrow: () => secret } as never,
  );
  return { service, tx, prisma, queries };
}

describe('DiscussionWindowService', () => {
  it('同一快照恢复窗口与置顶顺序，复用重叠楼层并附带受限回复预览', async () => {
    const { service, tx, prisma, queries } = setup();
    tx.post.findMany
      .mockResolvedValueOnce([ref('p2', 2), ref('p4', 4)])
      .mockResolvedValueOnce([ref('p4', 4)])
      .mockResolvedValueOnce([{ id: 'p4' }, { id: 'p2' }])
      .mockResolvedValueOnce([{ id: 'r1', parentPostId: 'p2' }]);
    tx.post.findFirst.mockResolvedValue({ id: 'edge' });
    tx.$queryRaw.mockResolvedValue([{ id: 'r1' }]);
    tx.post.groupBy.mockResolvedValue([{ parentPostId: 'p2', _count: 8 }]);

    const result = await service.find('floors', 'sub', { limit: 2 }, 'viewer');

    expect(result.items.map((row) => row.id)).toEqual(['p2', 'p4']);
    expect(result.pinnedItems.map((row) => row.id)).toEqual(['p4']);
    expect(result.items[0]).toMatchObject({ _count: { replies: 8 }, replies: [{ id: 'r1' }] });
    expect(result.items[1]).toMatchObject({ _count: { replies: 0 }, replies: [] });
    expect(tx.post.findMany.mock.calls[2][0].where.id.in).toEqual(['p2', 'p4']);
    expect(queries.findSubthreadContext).toHaveBeenCalledWith('sub', 'viewer', tx);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    const context = { ...cursorContext, scope: 'floors' as const, scopeId: 'sub' };
    expect(decodeDiscussionCursor(result.beforeCursor!, context, secret)).toMatchObject({
      direction: 'before',
      number: 2,
    });
    expect(decodeDiscussionCursor(result.afterCursor!, context, secret)).toMatchObject({
      direction: 'after',
      number: 4,
    });
  });

  it('围绕目标编号保持自然顺序，缺少前半页时补足后半页且不附加置顶', async () => {
    const { service, tx } = setup();
    tx.post.findFirst.mockResolvedValueOnce({ ...ref('p5', 5), authorId: 'author' });
    tx.post.findMany
      .mockResolvedValueOnce([ref('p4', 4)])
      .mockResolvedValueOnce([ref('p5', 5), ref('p6', 6), ref('p9', 9)])
      .mockResolvedValueOnce(['p9', 'p5', 'p4', 'p6'].map((id) => ({ id })));

    const result = await service.find('floors', 'sub', { number: 5, limit: 5 });

    expect(result.target).toEqual({ id: 'p5', number: 5 });
    expect(result.items.map((row) => row.id)).toEqual(['p4', 'p5', 'p6', 'p9']);
    expect(result.pinnedItems).toEqual([]);
    expect(tx.post.findMany.mock.calls[0][0]).toMatchObject({
      where: { AND: [{}, { floorNumber: { lt: 5 } }] },
      orderBy: { floorNumber: 'desc' },
      take: 2,
    });
    expect(tx.post.findMany.mock.calls[1][0]).toMatchObject({
      where: { AND: [{}, { floorNumber: { gte: 5 } }] },
      take: 4,
    });
  });

  it('按最新排序定位回复 ID，前后比较方向随排序反转', async () => {
    const { service, tx, queries } = setup();
    tx.post.findFirst.mockResolvedValueOnce({ ...ref('r5', 5), authorId: 'author' });
    tx.post.findMany
      .mockResolvedValueOnce([ref('r6', 6), ref('r9', 9)])
      .mockResolvedValueOnce([ref('r5', 5), ref('r4', 4)])
      .mockResolvedValueOnce(['r4', 'r5', 'r6', 'r9'].map((id) => ({ id })));

    const result = await service.find('replies', 'root', {
      postId: 'r5',
      order: ReplyOrder.NEWEST,
      limit: 5,
    });

    expect(result.items.map((row) => row.id)).toEqual(['r9', 'r6', 'r5', 'r4']);
    expect(queries.findDiscussionRoot).toHaveBeenCalledWith('root', undefined, tx);
    expect(tx.post.findMany.mock.calls[0][0]).toMatchObject({
      where: { AND: [{}, { replyNumber: { gt: 5 } }] },
      orderBy: { replyNumber: 'asc' },
    });
    expect(tx.post.findMany.mock.calls[1][0]).toMatchObject({
      where: { AND: [{}, { replyNumber: { lte: 5 } }] },
      orderBy: { replyNumber: 'desc' },
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(['before', 'after'] as const)(
    '游标 %s 只返回相邻窗口并保留用户阅读顺序',
    async (direction) => {
      const { service, tx } = setup();
      const cursor = encodeDiscussionCursor(
        {
          ...cursorContext,
          version: 1,
          number: 5,
          direction,
        },
        secret,
      );
      tx.post.findMany
        .mockResolvedValueOnce(
          direction === 'before' ? [ref('r4', 4), ref('r2', 2)] : [ref('r6', 6), ref('r8', 8)],
        )
        .mockResolvedValueOnce(['r8', 'r4', 'r6', 'r2'].map((id) => ({ id })));

      const result = await service.find('replies', 'root', { cursor, limit: 2 }, 'viewer');

      expect(result.items.map((row) => row.id)).toEqual(
        direction === 'before' ? ['r2', 'r4'] : ['r6', 'r8'],
      );
      expect(result).toMatchObject({
        target: null,
        pinnedItems: [],
        hasBefore: false,
        hasAfter: false,
      });
      expect(tx.post.findMany.mock.calls[0][0].where.AND[1]).toEqual({
        replyNumber: direction === 'before' ? { lt: 5 } : { gt: 5 },
      });
    },
  );

  it('失去作者资格后返回空集合，但编号上界仍来自当前可见范围', async () => {
    const { service, tx, queries } = setup();
    queries.isEligibleDiscussionAuthor.mockResolvedValue(false);
    tx.post.aggregate
      .mockResolvedValueOnce({ _count: 0, _max: { floorNumber: null } })
      .mockResolvedValueOnce({ _max: { floorNumber: 99 } });

    const result = await service.find('floors', 'sub', { authorId: 'former', limit: 100 });

    expect(result).toMatchObject({
      items: [],
      pinnedItems: [],
      total: 0,
      maxNumber: 99,
      hasBefore: false,
      hasAfter: false,
      beforeCursor: null,
      afterCursor: null,
    });
    expect(tx.post.findMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: [] }, authorId: 'former' },
      take: 50,
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([false, true])('目标不属于当前作者筛选时拒绝定位（资格=%s）', async (eligible) => {
    const { service, tx, queries } = setup();
    queries.isEligibleDiscussionAuthor.mockResolvedValue(eligible);
    tx.post.findFirst.mockResolvedValue({ ...ref('target', 1), authorId: 'other' });
    await expect(
      service.find('floors', 'sub', { number: 1, authorId: 'selected' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.DISCUSSION_TARGET_FILTERED });
    expect(tx.post.aggregate).not.toHaveBeenCalled();
  });

  it('不可见目标与不可读父范围均在正文载入前拒绝', async () => {
    const { service, tx, queries } = setup();
    await expect(service.find('floors', 'sub', { number: 3 })).rejects.toMatchObject({
      errorCode: ErrorCode.POST_NOT_FOUND,
    });
    queries.findSubthreadContext.mockRejectedValue(new Error('denied'));
    await expect(service.find('floors', 'sub', {})).rejects.toThrow('denied');
    expect(tx.post.findMany).not.toHaveBeenCalled();
  });

  it('多定位条件或借用其他用户游标在数据库访问前拒绝', async () => {
    const { service, prisma } = setup();
    await expect(service.find('floors', 'sub', { number: 1, postId: 'p1' })).rejects.toMatchObject({
      errorCode: ErrorCode.BAD_REQUEST,
    });
    const cursor = encodeDiscussionCursor(
      {
        ...cursorContext,
        version: 1,
        number: 5,
        direction: 'after',
      },
      secret,
    );
    await expect(service.find('replies', 'root', { cursor }, 'other')).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_CURSOR,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
