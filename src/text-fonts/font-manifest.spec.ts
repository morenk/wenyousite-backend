import {
  FontManifest,
  validateFontManifest,
  fontManifestAssets,
  FONT_DOCUMENT_MAX_BYTES,
  FONT_SHARD_MAX_BYTES,
} from './font-manifest';
import { canonicalFontJson, fontBuildIdentity } from './font-build-identity';
import { FontConfigurationDto } from './dto/font-admin.dto';

const key = 'a'.repeat(64),
  source = 'b'.repeat(64);
function fixture(): FontManifest {
  return {
    manifestVersion: 2,
    buildKey: key,
    sourceSha256: source,
    baseWeight: 400,
    baseStyle: 'normal',
    coverage: { codepointCount: 3, unicodeRanges: ['U+0041-0043'] },
    shards: [
      {
        id: 'latin-a',
        family: `WYF2-${key.slice(0, 32)}-latin-a`,
        unicodeRanges: ['U+0041-0042'],
        codepointCount: 2,
        web: { sha256: 'c'.repeat(64), bytes: 4, format: 'woff2' },
        mobile: { sha256: 'd'.repeat(64), bytes: 4, format: 'ttf' },
      },
      {
        id: 'latin-b',
        family: `WYF2-${key.slice(0, 32)}-latin-b`,
        unicodeRanges: ['U+0043'],
        codepointCount: 1,
        web: { sha256: 'e'.repeat(64), bytes: 4, format: 'woff2' },
        mobile: { sha256: 'f'.repeat(64), bytes: 4, format: 'otf' },
      },
    ],
    notices: [{ sha256: '1'.repeat(64), bytes: 2, format: 'json' }],
    specimen: { sha256: '2'.repeat(64), bytes: 4, format: 'png' },
  };
}

describe('不可信字体 manifest 的结构、覆盖范围与资源预算', () => {
  it('相邻分片合并后必须精确覆盖全集，同一内容资源可去重', () => {
    const value = fixture();
    value.notices.push({ ...value.notices[0] });
    expect(validateFontManifest(value, key, source)).toEqual(value);
    expect(fontManifestAssets(value)).toHaveLength(6);
    value.coverage.unicodeRanges = ['U+0041-0042', 'U+0043'];
    expect(validateFontManifest(value)).toEqual(value);
  });
  it.each([
    'build',
    'source',
    'family',
    'duplicate-id',
    'duplicate-family',
    'web-format',
    'mobile-format',
  ] as const)('拒绝 %s 身份污染', (field) => {
    const value = fixture();
    if (field === 'build') value.buildKey = source;
    if (field === 'source') value.sourceSha256 = key;
    if (field === 'family') value.shards[0].family = `WYF2-${source.slice(0, 32)}-latin-a`;
    if (field === 'duplicate-id') value.shards[1].id = value.shards[0].id;
    if (field === 'duplicate-family') value.shards[1].family = value.shards[0].family;
    if (field === 'web-format') value.shards[0].web.format = 'ttf';
    if (field === 'mobile-format') value.shards[0].mobile.format = 'woff2';
    expect(() => validateFontManifest(value, key, source)).toThrow(/font_(build|shard)_identity/);
  });
  it.each([
    ['U+0042-0041'],
    ['U+D800'],
    ['U+110000'],
    ['U+0042', 'U+0041'],
    ['U+0041-0042', 'U+0042'],
    ['U+0041'],
  ])('拒绝非法、重叠、乱序或计数不符范围 %j', (...ranges) => {
    const value = fixture();
    value.shards[0].unicodeRanges = ranges;
    expect(() => validateFontManifest(value)).toThrow('font_coverage_invalid');
  });
  it('拒绝跨分片重叠或遗漏，不以声明的总数代替实际范围核对', () => {
    const value = fixture();
    value.shards[1].unicodeRanges = ['U+0042'];
    expect(() => validateFontManifest(value)).toThrow('font_coverage_overlap');
    value.shards[1].unicodeRanges = ['U+0044'];
    expect(() => validateFontManifest(value)).toThrow('font_coverage_invalid');
  });
  it.each(['specimen-format', 'notice-format', 'specimen-size', 'notice-size'] as const)(
    '拒绝 %s 文档描述',
    (field) => {
      const value = fixture();
      if (field === 'specimen-format') value.specimen.format = 'ttf';
      if (field === 'notice-format') value.notices[0].format = 'png';
      if (field === 'specimen-size') value.specimen.bytes = FONT_DOCUMENT_MAX_BYTES + 1;
      if (field === 'notice-size') value.notices[0].bytes = FONT_DOCUMENT_MAX_BYTES + 1;
      expect(() => validateFontManifest(value)).toThrow('font_notice_identity');
    },
  );
  it('拒绝同一对象的矛盾长度、总输出超限及未知结构字段', () => {
    const value = fixture();
    value.notices.push({ ...value.notices[0], bytes: 3 });
    expect(() => fontManifestAssets(value)).toThrow('font_asset_identity');
    value.notices.pop();
    value.shards = Array.from({ length: 100 }, (_, i) => ({
      ...value.shards[0],
      web: {
        sha256: i.toString(16).padStart(64, '0'),
        bytes: FONT_SHARD_MAX_BYTES,
        format: 'woff2',
      },
    }));
    expect(() => fontManifestAssets(value)).toThrow('font_output_limit');
    expect(() => validateFontManifest({ ...fixture(), arbitrary: true })).toThrow();
  });
});

it('构建身份与对象键顺序无关，但绑定源、授权和样张配置', async () => {
  expect(canonicalFontJson({ b: [null, 3], a: { d: true, c: '值' } })).toBe(
    '{"a":{"c":"值","d":true},"b":[null,3]}',
  );
  const config: FontConfigurationDto = {
    name: '字体',
    designLanguage: 'zh',
    sortOrder: 0,
    author: '作者',
    sourceUrl: 'https://example.invalid',
    licenseName: 'OFL',
    licenseText: '许可',
    specimenText: '样张',
    rights: { redistribution: true, conversion: true, subsetting: true },
  };
  const first = await fontBuildIdentity(source, config);
  expect(
    await fontBuildIdentity(
      source,
      Object.fromEntries(Object.entries(config).reverse()) as unknown as FontConfigurationDto,
    ),
  ).toEqual(first);
  expect((await fontBuildIdentity(key, config)).key).not.toBe(first.key);
  expect((await fontBuildIdentity(source, { ...config, licenseText: '不同授权' })).key).not.toBe(
    first.key,
  );
  expect((await fontBuildIdentity(source, { ...config, specimenText: '不同样张' })).key).not.toBe(
    first.key,
  );
});
