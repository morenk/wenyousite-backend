import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../contracts', name), 'utf8'));
it('共享旧字体路由夹具固定映射，不允许状态未知或墓碑回退公共资源', () => {
  const mapping = read('thread-font-v1-import-map.json');
  const fixture = read('thread-font-dynamic-v2-fixtures.json');
  expect(fixture.legacyRoutingRules).toMatchObject({
    allowLegacyManifestFallback: false,
    activationStickyWithinSession: true,
    serverSupportRequiresAllMappedVersionsPublished: true,
    legacyPublicBytesRevocable: false,
  });
  for (const row of fixture.legacyRoutingCases) {
    expect(
      mapping.fonts.find((font: { legacyId: string }) => font.legacyId === row.legacyId)?.versionId,
    ).toBe(row.versionId);
    expect(row.expectedLegacyManifestRequests).toBe(0);
    expect(row.expectedSourceUnchanged).toBe(true);
    if (
      row.response === 'withdrawn' ||
      row.lastTrustedStatus === 'withdrawn' ||
      (!row.lastTrustedStatus && ['404', 'unknown', 'network-error'].includes(row.response))
    ) {
      expect(row.expectedRenderAllowed).toBe(false);
      expect(row.expectedPasteAllowed).toBe(false);
      expect(row.expectedAssetRequest).toBe('none');
    }
  }
  expect(
    new Set(fixture.legacyRoutingCases.map((row: { response: string }) => row.response)),
  ).toEqual(
    new Set([
      'published',
      'disabled',
      'withdrawn',
      'unknown',
      '404',
      'network-error',
      'stale-published',
    ]),
  );
});

it('已激活映射或已知墓碑不因能力降级退回旧通道', () => {
  for (const row of read('thread-font-dynamic-v2-fixtures.json').legacyCapabilityCases) {
    if (row.knownWithdrawn) expect(row.expectedRoute).toBe('default-font');
    else if (row.previouslyActivated) expect(row.expectedRoute).toBe('mapped-v2');
    else expect(row.expectedRoute).toBe('legacy-v1');
  }
});
