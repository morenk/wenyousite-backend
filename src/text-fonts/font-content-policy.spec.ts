import { Prisma } from '@prisma/client';
import { assertFontWriteInTransaction } from './font-content-policy';
import { FONT_LEGACY_IMPORT } from './font-legacy-map';

describe('字体正文事务授权', () => {
  const legacy = FONT_LEGACY_IMPORT.fonts[0];
  const id = 'tfv_' + 'a'.repeat(32);
  const mark = (font: string, text = '文字') =>
    `<span data-wenyou-font-v${font.startsWith('tfv_') ? 2 : 1}="${font}">${text}</span>`;
  function transaction(rows: unknown[]) {
    const query = jest.fn().mockResolvedValue(rows);
    const lock = jest.fn().mockResolvedValue([]);
    return {
      tx: {
        textFontVersion: { findMany: query },
        $queryRaw: lock,
      } as unknown as Prisma.TransactionClient,
      query,
      lock,
    };
  }
  const active = (version: string) => ({
    id: version,
    publishedAt: new Date(),
    withdrawnAt: null,
    family: { enabled: true },
  });

  it('混合且重复 ID 只做一次批量查询，先持有共享锁', async () => {
    const { tx, query, lock } = transaction([active(id), active(legacy.versionId)]);
    await assertFontWriteInTransaction(
      tx,
      mark(id) + mark(legacy.legacyId) + mark(id, '另一段'),
      '',
      2,
      true,
      true,
      true,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(new Set(query.mock.calls[0][0].where.id.in)).toEqual(new Set([id, legacy.versionId]));
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]);
  });

  it.each(['disabled', 'withdrawn'])('关闭 v2 写开关也不能绕过旧字体 %s 状态', async (state) => {
    const row = active(legacy.versionId);
    if (state === 'disabled') row.family.enabled = false;
    else row.withdrawnAt = new Date() as never;
    const { tx } = transaction([row]);
    await expect(
      assertFontWriteInTransaction(tx, mark(legacy.legacyId), '', 1, true, false, true),
    ).rejects.toThrow();
    await expect(
      assertFontWriteInTransaction(
        tx,
        mark(legacy.legacyId) + '修改普通文本',
        mark(legacy.legacyId),
        1,
        true,
        false,
        true,
      ),
    ).resolves.toBeUndefined();
  });

  it('未完成导入时保留 v1 既有策略；未知 v2 新增不能写入', async () => {
    const { tx } = transaction([]);
    await expect(
      assertFontWriteInTransaction(tx, mark(legacy.legacyId), '', 1, true, false, true),
    ).resolves.toBeUndefined();
    await expect(
      assertFontWriteInTransaction(tx, mark(id), '', 2, true, true, true),
    ).rejects.toThrow();
  });
});
