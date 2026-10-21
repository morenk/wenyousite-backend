#!/usr/bin/env node
// 默认门禁无需下载字体或安装 Python；校验已提交的机器契约、索引和大小账本。
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

const root = process.argv[2] || path.resolve(__dirname, '../..');
const read = (name) => readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const catalog = json('contracts/thread-font-catalog-v1.json');
const manifestBytes = read('contracts/thread-font-manifest-v1.json');
const manifest = JSON.parse(manifestBytes);
const sources = json('contracts/thread-font-sources-v1.json');
const ajv = new Ajv({ allErrors: true });
for (const [name, value] of [['catalog', catalog], ['manifest', manifest], ['sources', sources]]) {
  const validate = ajv.compile(json(`contracts/thread-font-${name}-v1.schema.json`));
  assert(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`);
}
const generated = read('src/common/text-font-assets.generated.ts').toString();
const match = generated.match(/export const TEXT_FONT_ASSET_INDEX\s*=\s*([\s\S]+?)\s+as const;/);
assert(match, 'generated index missing');
const index = JSON.parse(match[1]);
const ids = catalog.fonts.map((font) => font.id);
assert.equal(new Set(ids).size, ids.length, 'duplicate font id');
assert.deepEqual(['zh', 'ja', 'en'].map((language) => catalog.fonts.filter((font) => font.designLanguage === language).length), [13, 10, 6]);
assert(!ids.includes('zcoolxiaowei'));
for (const id of ['shinsyoku-mincho', 'bouken-gothic', 'hakkou-mincho', 'kaitou-yokoku-gothic'])
  assert.equal(catalog.fonts.find((font) => font.id === id).designLanguage, 'ja');
assert.deepEqual(manifest.fonts.map((font) => font.id), ids);
assert.deepEqual(sources.fonts.map((font) => font.id), ids);
assert.equal(manifest.catalogVersion, catalog.catalogVersion);
assert.equal(index.catalogVersion, catalog.catalogVersion);
assert.deepEqual(index.manifest, { path: `fonts/v1/${sha(manifestBytes)}.json`, sha256: sha(manifestBytes), bytes: manifestBytes.length });
assert.deepEqual(index.fonts, catalog.fonts);
assert.deepEqual(index.limits, manifest.limits);
let totalBytes = manifestBytes.length;
const uniqueAssets = new Map();
const checkAsset = (asset) => {
  assert(asset.path.startsWith(`fonts/v1/${asset.sha256}.`), 'hash/path mismatch');
  assert(!asset.path.includes('..') && !asset.path.includes('://'));
  if (uniqueAssets.has(asset.path)) assert.deepEqual(uniqueAssets.get(asset.path), asset.bytes);
  else { uniqueAssets.set(asset.path, asset.bytes); totalBytes += asset.bytes; }
};
for (let position = 0; position < ids.length; position += 1) {
  const font = manifest.fonts[position];
  const source = sources.fonts[position];
  assert.equal(font.designLanguage, catalog.fonts[position].designLanguage);
  assert(['zh', 'ja', 'en'].includes(font.designLanguage));
  assert.equal(font.availability, catalog.fonts[position].availability);
  if (font.availability !== 'ready') {
    assert.notEqual(source.status, 'locked');
    assert.equal(font.shards.length, 0);
    continue;
  }
  assert.equal(source.status, 'locked');
  assert.equal(font.sourceSha256, source.sha256);
  assert.equal(font.sourceBytes, source.bytes);
  assert.equal(font.sourceRevision, source.sourceRevision);
  assert.equal(font.baseWeight, 400);
  assert.equal(font.baseStyle, 'normal');
  assert.equal(font.fontSha256, source.fontSha256 || source.sha256);
  assert(font.coverage.ascii.present <= 95);
  assert.equal(font.coverage.ascii.total, 95);
  assert.equal(font.coverage.gb2312.total, 6763);
  const covered = new Set();
  const shardIds = new Set();
  for (const shard of font.shards) {
    assert.equal(shard.family, `WYF1-${font.fontSha256.slice(0, 16)}-${shard.id}`);
    assert(!shardIds.has(shard.id), 'duplicate shard id'); shardIds.add(shard.id);
    let count = 0;
    for (const range of shard.unicodeRanges) {
      const [start, end = start] = range.slice(2).split('-').map((value) => parseInt(value, 16));
      assert(end >= start && end <= 0x10ffff && end - start <= 0x10000);
      for (let point = start; point <= end; point += 1) {
        assert(!covered.has(point), 'overlapping shards'); covered.add(point); count += 1;
      }
    }
    assert.equal(count, shard.codepointCount);
    assert.equal(shard.web.format, 'woff2');
    assert(['ttf', 'otf'].includes(shard.mobile.format));
    for (const asset of [shard.web, shard.mobile]) {
      checkAsset(asset); assert(asset.bytes <= manifest.limits.maxAssetBytes);
    }
  }
  assert.equal(covered.size, font.coverage.totalCodepoints);
  assert.equal(font.totalWebBytes, font.shards.reduce((sum, shard) => sum + shard.web.bytes, 0));
  assert.equal(font.totalMobileBytes, font.shards.reduce((sum, shard) => sum + shard.mobile.bytes, 0));
  assert(font.notices.some((notice) => notice.kind === 'license'));
  assert(font.notices.some((notice) => notice.kind === 'attribution'));
  for (const notice of font.notices) checkAsset(notice);
}
assert(totalBytes <= manifest.limits.maxBundleBytes);
console.log(`字体资源契约通过：${ids.length} 家族，${uniqueAssets.size} 资产，${totalBytes} 字节；不读取网络或业务数据。`);
