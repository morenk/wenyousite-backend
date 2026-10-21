import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FontConfigurationDto } from './dto/font-admin.dto';
import { FontAssetDto } from './dto/font-public.dto';
import { FONT_LEGACY_IMPORT } from './font-legacy-map';
import { fontSha } from './font-domain';
import { FontStorageService } from './font-storage.service';
import { FontManifest } from './font-manifest';

export type LegacyAsset = FontAssetDto & { path: string };
export type LegacyFont = {
  id: string;
  name: string;
  availability: string;
  designLanguage: FontConfigurationDto['designLanguage'];
  fontSha256: string;
  sourceSha256: string;
  license: string;
  coverage: { totalCodepoints: number };
  shards: Array<
    Omit<FontManifest['shards'][number], 'web' | 'mobile'> & {
      web: LegacyAsset;
      mobile: LegacyAsset;
    }
  >;
  notices: Array<{ path: string; sha256: string; bytes: number; kind: string }>;
};
export type LegacyBundle = {
  fonts: LegacyFont[];
  toolchain: Record<string, string>;
};

/** 仅接受仓库锁定的 28 款；外部 manifest 不能改变路径、字节或原生 family。 */
export async function loadLegacyBundle(): Promise<LegacyBundle> {
  const data = await readFile(join(__dirname, '../../contracts/thread-font-manifest-v1.json'));
  if (fontSha(data) !== FONT_LEGACY_IMPORT.sourceManifestSha256)
    throw new Error('font_legacy_manifest_identity');
  const manifest = JSON.parse(data.toString('utf8')) as LegacyBundle;
  if (
    manifest.fonts.length !== FONT_LEGACY_IMPORT.fonts.length ||
    manifest.fonts.some(
      (font) =>
        font.availability !== 'ready' ||
        !FONT_LEGACY_IMPORT.fonts.some((row) => row.legacyId === font.id),
    )
  )
    throw new Error('font_legacy_manifest_identity');
  return manifest;
}

export async function readLegacyAsset(
  storage: FontStorageService,
  bundleRoot: string,
  asset: { path: string; sha256: string; bytes: number },
): Promise<Buffer> {
  if (
    !/^fonts\/v1\/[a-f0-9]{64}\.(?:ttf|otf|woff2|txt|json)$/u.test(asset.path) ||
    !asset.path.endsWith(`/${asset.sha256}.${asset.path.split('.').at(-1)}`)
  )
    throw new Error('font_legacy_asset_identity');
  const data = await storage.readChecked(join(bundleRoot, asset.path), asset.bytes);
  if (fontSha(data) !== asset.sha256) throw new Error('font_legacy_asset_identity');
  return data;
}

export function legacyCoverage(font: LegacyFont): FontManifest['coverage'] {
  const ranges = font.shards
    .flatMap((shard) => shard.unicodeRanges)
    .map((value) => {
      const bounds = value
        .slice(2)
        .split('-')
        .map((part) => parseInt(part, 16));
      return [bounds[0], bounds.at(-1)!];
    })
    .sort((a, b) => a[0] - b[0]);
  const combined: number[][] = [];
  for (const [first, last] of ranges) {
    const prior = combined.at(-1);
    if (prior && first <= prior[1]) throw new Error('font_legacy_coverage_overlap');
    if (prior && first === prior[1] + 1) prior[1] = last;
    else combined.push([first, last]);
  }
  const hex = (point: number) => point.toString(16).toUpperCase().padStart(4, '0');
  return {
    codepointCount: font.coverage.totalCodepoints,
    unicodeRanges: combined.map(
      ([first, last]) => `U+${hex(first)}${first === last ? '' : `-${hex(last)}`}`,
    ),
  };
}

export function legacyBuildKey(font: LegacyFont): string {
  return fontSha(
    JSON.stringify({
      importer: 'legacy-v1-preserved-v1',
      manifest: FONT_LEGACY_IMPORT.sourceManifestSha256,
      legacyId: font.id,
    }),
  );
}
