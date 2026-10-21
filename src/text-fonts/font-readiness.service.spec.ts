import { FontReadinessService } from './font-readiness.service';
import { FontStorageService } from './font-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { FONT_LEGACY_IMPORT } from './font-legacy-map';

describe('v2 能力启用必须先有全部固定历史版本和私有资产', () => {
  const versions = () =>
    FONT_LEGACY_IMPORT.fonts.map((row) => ({
      id: row.versionId,
      familyId: row.familyId,
      artifact: { specimenSha: 'a'.repeat(64), specimenSize: 1200 },
    }));
  function setup(rows = versions()) {
    const query = jest
      .fn<Promise<unknown[]>, [{ where: Record<string, unknown> }]>()
      .mockResolvedValue(rows);
    const probe = jest.fn().mockResolvedValue(undefined);
    const verifyAssets = jest.fn();
    const storage = { requireConfigured: jest.fn(), probe, verifyAssets };
    const service = new FontReadinessService(
      { textFontVersion: { findMany: query } } as unknown as PrismaService,
      storage as unknown as FontStorageService,
    );
    return { service, query, probe, verifyAssets, storage };
  }
  afterEach(() => jest.useRealTimers());

  it('部分导入和映射不一致不能宣告支持', async () => {
    expect(await setup(versions().slice(1)).service.supported()).toBe(false);
    const rows = versions();
    rows[0].familyId = rows[1].familyId;
    expect(await setup(rows).service.supported()).toBe(false);
  });

  it('不按停用、撤回或当前版本过滤；成功后能力不降级', async () => {
    const { service, query, probe, verifyAssets } = setup();
    expect(await service.supported()).toBe(true);
    const where = query.mock.calls[0][0].where;
    expect(Object.keys(where).sort()).toEqual(['id', 'publishedAt']);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(verifyAssets).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).toMatchObject({
      select: { artifact: { select: { specimenSha: true, specimenSize: true } } },
    });
    query.mockResolvedValue([]);
    expect(await service.supported()).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('存储探测失败关闭；同轮合并查询并在恢复后允许重试', async () => {
    jest.useFakeTimers();
    const { service, query, probe } = setup();
    probe.mockRejectedValueOnce(new Error('private-storage-unavailable'));
    expect(await Promise.all([service.supported(), service.supported()])).toEqual([false, false]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(await service.supported()).toBe(false);
    jest.advanceTimersByTime(10001);
    expect(await service.supported()).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
