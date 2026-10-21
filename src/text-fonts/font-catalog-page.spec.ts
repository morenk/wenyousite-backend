import { fontCatalogPage, fontEnvelopeBytes, fontEtag } from './font-catalog-page';
import { FontCatalogEntryDto } from './dto/font-public.dto';
const release = 'tfc_' + 'c'.repeat(32);
const entries: FontCatalogEntryDto[] = Array.from({ length: 200 }, (_, i) => ({
  familyId: 'tff_' + i.toString(16).padStart(32, '0'),
  versionId: 'tfv_' + i.toString(16).padStart(32, '0'),
  name: '温'.repeat(80),
  designLanguage: 'zh',
  sortOrder: i,
  selectable: true,
  pasteAllowed: true,
  renderAllowed: true,
  assetBasePath:
    '/api/v1/meta/text-fonts/v2/versions/tfv_' + i.toString(16).padStart(32, '0') + '/assets/',
  specimen: { sha256: 'a'.repeat(64), bytes: 1000, format: 'png' },
}));
it('200 项长中文名按完整 UTF-8 信封截页，游标不漏不重且 ETag 稳定', () => {
  const found: string[] = [];
  let cursor: string | undefined;
  do {
    const page = fontCatalogPage(release, 1, entries, { limit: 200, cursor });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThan(200);
    expect(fontEnvelopeBytes(page)).toBeLessThanOrEqual(65536);
    expect((page.nextCursor ?? '').length).toBeLessThanOrEqual(512);
    expect(fontEtag(page)).toBe(
      fontEtag(fontCatalogPage(release, 1, entries, { limit: 200, cursor })),
    );
    found.push(...page.items.map((entry) => entry.versionId));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(found).toEqual(entries.map((entry) => entry.versionId));
});
it('修订或 limit 变化及伪造游标拒绝，不混合两次发布', () => {
  const page = fontCatalogPage(release, 1, entries, { limit: 1 });
  expect(() =>
    fontCatalogPage(release, 2, entries, { limit: 1, cursor: page.nextCursor! }),
  ).toThrow();
  expect(() =>
    fontCatalogPage(release, 1, entries, { limit: 2, cursor: page.nextCursor! }),
  ).toThrow();
  expect(() => fontCatalogPage(release, 1, entries, { limit: 1, cursor: 'bad' })).toThrow();
});
