import { z } from 'zod';
import { FontAssetDto } from './dto/font-public.dto';

export const FONT_SHARD_MAX_BYTES = 6 * 1024 * 1024;
export const FONT_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
export const FONT_OUTPUT_MAX_BYTES = 512 * 1024 * 1024;
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const asset = z
  .object({
    sha256: sha,
    bytes: z.number().int().min(1).max(FONT_SHARD_MAX_BYTES),
    format: z.enum(['woff2', 'ttf', 'otf', 'json', 'png']),
  })
  .strict();
const ranges = z
  .array(z.string().regex(/^U\+[0-9A-F]{4,6}(?:-[0-9A-F]{4,6})?$/u))
  .min(1)
  .max(1112064);
const schema = z
  .object({
    manifestVersion: z.literal(2),
    buildKey: sha,
    sourceSha256: sha,
    baseWeight: z.literal(400),
    baseStyle: z.literal('normal'),
    coverage: z
      .object({ codepointCount: z.number().int().min(1).max(1112064), unicodeRanges: ranges })
      .strict(),
    shards: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,32}$/u),
            family: z.string().regex(/^(?:WYF2-[a-f0-9]{32}|WYF1-[a-f0-9]{16})-[a-z0-9-]{1,32}$/u),
            unicodeRanges: ranges,
            codepointCount: z.number().int().min(1).max(1112064),
            web: asset,
            mobile: asset,
          })
          .strict(),
      )
      .min(1)
      .max(4096),
    notices: z.array(asset).min(1).max(8),
    specimen: asset,
  })
  .strict();
export type FontManifest = z.infer<typeof schema>;
type Interval = [number, number];
function intervals(values: string[], count: number): Interval[] {
  let previous = -1,
    total = 0;
  const result = values.map((value): Interval => {
    const parts = value
      .slice(2)
      .split('-')
      .map((part) => parseInt(part, 16));
    const first = parts[0],
      last = parts.at(-1)!;
    if (first <= previous || last < first || last > 0x10ffff || (first <= 0xdfff && last >= 0xd800))
      throw new Error('font_coverage_invalid');
    previous = last;
    total += last - first + 1;
    return [first, last];
  });
  if (total !== count) throw new Error('font_coverage_invalid');
  return result;
}
function merged(values: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [first, last] of values.toSorted((a, b) => a[0] - b[0])) {
    const previous = result.at(-1);
    if (previous && first <= previous[1]) throw new Error('font_coverage_overlap');
    if (previous && first === previous[1] + 1) previous[1] = last;
    else result.push([first, last]);
  }
  return result;
}
export function validateFontManifest(
  value: unknown,
  buildKey?: string,
  sourceSha256?: string,
): FontManifest {
  const manifest = schema.parse(value);
  if (
    (buildKey && manifest.buildKey !== buildKey) ||
    (sourceSha256 && manifest.sourceSha256 !== sourceSha256)
  )
    throw new Error('font_build_identity');
  const ids = new Set<string>(),
    families = new Set<string>();
  const coverage: Interval[] = [];
  for (const shard of manifest.shards) {
    if (
      ids.has(shard.id) ||
      families.has(shard.family) ||
      shard.web.format !== 'woff2' ||
      !['ttf', 'otf'].includes(shard.mobile.format)
    )
      throw new Error('font_shard_identity');
    if (buildKey && shard.family !== `WYF2-${buildKey.slice(0, 32)}-${shard.id}`)
      throw new Error('font_shard_identity');
    ids.add(shard.id);
    families.add(shard.family);
    for (const interval of intervals(shard.unicodeRanges, shard.codepointCount))
      coverage.push(interval);
  }
  const expected = merged(
    intervals(manifest.coverage.unicodeRanges, manifest.coverage.codepointCount),
  );
  if (JSON.stringify(merged(coverage)) !== JSON.stringify(expected))
    throw new Error('font_coverage_invalid');
  if (
    manifest.specimen.format !== 'png' ||
    manifest.specimen.bytes > FONT_DOCUMENT_MAX_BYTES ||
    manifest.notices.some(
      (notice) => notice.format !== 'json' || notice.bytes > FONT_DOCUMENT_MAX_BYTES,
    )
  )
    throw new Error('font_notice_identity');
  fontManifestAssets(manifest);
  return manifest;
}
export function fontManifestAssets(manifest: FontManifest): FontAssetDto[] {
  const assets = new Map<string, FontAssetDto>();
  for (const item of [
    manifest.specimen,
    ...manifest.notices,
    ...manifest.shards.flatMap((shard) => [shard.web, shard.mobile]),
  ]) {
    const key = `${item.sha256}.${item.format}`;
    if (assets.has(key) && assets.get(key)!.bytes !== item.bytes)
      throw new Error('font_asset_identity');
    assets.set(key, item);
  }
  if ([...assets.values()].reduce((total, item) => total + item.bytes, 0) > FONT_OUTPUT_MAX_BYTES)
    throw new Error('font_output_limit');
  return [...assets.values()];
}
