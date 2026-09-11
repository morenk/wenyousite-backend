import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { parseDisplayBackfillArgs, planDisplayBackfill } from './media-display-backfill';

describe('历史完整展示补处理计划', () => {
  const db = { media: { findMany: jest.fn() } };
  const queue = { getJob: jest.fn(), add: jest.fn() };
  const emit = jest.fn();
  beforeEach(() => { jest.clearAllMocks(); db.media.findMany.mockResolvedValue([{ id: 'm', displayStatus: null, displayAttempts: 0 }]); queue.getJob.mockResolvedValue(null); queue.add.mockResolvedValue({}); });
  const run = (options = {}) => planDisplayBackfill(db as unknown as PrismaClient, queue as unknown as Queue, options, emit);
  it('默认dry-run只读，只列媒体ID不输出原地址、对象key或凭证', async () => {
    expect(await run()).toMatchObject({ mode: 'dry-run', scanned: 1, enqueued: 0 });
    expect(queue.add).not.toHaveBeenCalled(); expect(queue.getJob).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({ mediaId: 'm', action: 'ELIGIBLE', attempts: 0 });
  });
  it('有界分页不丢下一页，累计失败上限不得被重复apply绕过', async () => {
    db.media.findMany.mockResolvedValue([{ id: 'a', displayStatus: 'FAILED', displayAttempts: 3 }, { id: 'b', displayAttempts: 0 }]);
    expect(await run({ apply: true, limit: 1, after: '0' })).toMatchObject({ scanned: 1, hasMore: true, nextCursor: 'a', enqueued: 0 });
    expect(queue.add).not.toHaveBeenCalled(); expect(db.media.findMany.mock.calls[0][0]).toMatchObject({ take: 2, where: { id: { gt: '0' }, status: 'COMPLETED', deletionClaimedAt: null } });
  });
  it('已在队列的同一媒体不重复排队，终态安全重试使用稳定ID', async () => {
    queue.getJob.mockResolvedValueOnce({ getState: async () => 'active' }); await run({ apply: true }); expect(queue.add).not.toHaveBeenCalled();
    const remove = jest.fn(); queue.getJob.mockResolvedValueOnce({ getState: async () => 'failed', remove });
    await run({ apply: true }); expect(remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('display-backfill', { mediaId: 'm' }, expect.objectContaining({ jobId: 'display-m', attempts: 3 }));
  });
  it('扫描包含Web和Mobile背景关系，并在连接前拒绝缺值/重复参数', async () => {
    await run();
    expect(db.media.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [{ contentType: 'image/gif' }, { contentType: null, animated: true }] }]);
    expect(db.media.findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([
      { profileCoverUser: { isNot: null } }, { profileCoverMobileUser: { isNot: null } },
    ]));
    for (const args of [['--after'], ['--limit'], ['--after', '--apply'], ['--limit', '1', '--limit', '2'], ['--apply', '--apply'], ['--unknown']]) {
      expect(() => parseDisplayBackfillArgs(args)).toThrow();
    }
    expect(parseDisplayBackfillArgs(['--apply', '--limit', '3', '--after', 'media-1'])).toEqual({ apply: true, limit: 3, after: 'media-1' });
  });
  it.each([0, 1001, 1.5, NaN])('非法limit %s不能执行查询', async (limit) => {
    await expect(run({ limit })).rejects.toThrow('DISPLAY_BACKFILL_LIMIT_INVALID'); expect(db.media.findMany).not.toHaveBeenCalled();
  });
});
