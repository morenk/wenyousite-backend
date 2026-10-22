import { Prisma } from '@prisma/client';
import { assertTextFontWrite, parseTextFonts } from '../common/text-colors';
import { lockFontState } from './font-domain';
import { FONT_LEGACY_VERSIONS } from './font-legacy-map';

/** 事务前只做正文/能力检查；动态 ID 是否准入由提交事务再次查询持久状态。 */
export function assertFontWritePreflight(
  content: string,
  previous: string,
  version: number | undefined,
  v1Enabled: boolean,
  v2Enabled: boolean,
): void {
  const candidates = v2Enabled
    ? new Set(
        parseTextFonts(content, true)
          .filter((range) => range.fontVersion === 2)
          .map((range) => range.fontId),
      )
    : new Set<string>();
  assertTextFontWrite(content, previous, version, v1Enabled, candidates);
}

/** 每份正文只按去重版本批量查询一次；共享锁持有到正文事务提交，撤回/停用不能穿透。 */
export async function assertFontWriteInTransaction(
  tx: Prisma.TransactionClient,
  content: string,
  previous: string,
  version: number | undefined,
  v1Enabled: boolean,
  v2Enabled: boolean,
  legacyStateEnabled = false,
): Promise<void> {
  const ranges = parseTextFonts(content, true);
  const legacy = new Map(
    ranges
      .filter((range) => range.fontVersion !== 2 && FONT_LEGACY_VERSIONS.has(range.fontId))
      .map((range) => [FONT_LEGACY_VERSIONS.get(range.fontId)!, range.fontId]),
  );
  const ids = [
    ...new Set(ranges.filter((range) => range.fontVersion === 2).map((range) => range.fontId)),
  ];
  const allowed = new Set<string>();
  const blockedLegacy = new Set<string>();
  if ((v2Enabled && ids.length) || (legacyStateEnabled && legacy.size)) {
    await lockFontState(tx, true);
    const versions = await tx.textFontVersion.findMany({
      where: {
        id: { in: [...new Set([...ids, ...legacy.keys()])] },
      },
      select: {
        id: true,
        publishedAt: true,
        withdrawnAt: true,
        family: { select: { enabled: true } },
      },
    });
    for (const row of versions) {
      if (row.publishedAt && !row.withdrawnAt && row.family.enabled) {
        if (v2Enabled) allowed.add(row.id);
      } else if (legacy.has(row.id)) blockedLegacy.add(legacy.get(row.id)!);
    }
  }
  assertTextFontWrite(content, previous, version, v1Enabled, allowed, blockedLegacy);
}
