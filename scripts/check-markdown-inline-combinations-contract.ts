/** 行内格式组合黄金契约：只校验独立预期，不生成客户端序列化结果。 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { prepareMarkdownContent } from '../src/common/markdown-content';
import { summarize } from './rich-text/semantics';

const name = 'markdown-inline-combinations-v1-fixtures.json';
const source = readFileSync(resolve('contracts', name), 'utf8');
const fixture = JSON.parse(source);
const schemaName = 'markdown-inline-combinations-v1.schema.json';
const schemaSource = readFileSync(resolve('contracts', schemaName), 'utf8');
const validate = new Ajv({ strict: false, allErrors: true }).compile(JSON.parse(schemaSource));
assert.ok(validate(fixture), JSON.stringify(validate.errors));
const signatures = new Set(fixture.markSets.map((item: { marks: object }) => Object.keys(item.marks).sort().join(',')));
assert.equal(signatures.size, 32);
for (let mask = 0; mask < 32; mask++) {
  const keys = fixture.markOrder.filter((_: string, index: number) => mask & (1 << index)).sort();
  assert.ok(signatures.has(keys.join(',')), `缺少样式集合 ${keys.join('+')}`);
}
assert.equal(new Set(fixture.markSets.map((item: { id: string }) => item.id)).size, 32);
assert.equal(new Set(fixture.cases.map((item: { id: string }) => item.id)).size, fixture.cases.length);
for (const item of fixture.cases) {
  if (item.kind === 'canonical') {
    assert.equal(prepareMarkdownContent(item.canonical), item.canonical, item.id);
    assert.deepEqual(summarize(item.canonical).blocks, [{ type: 'paragraph', alignment: 'left', children: item.segments.map((segment: object) => ({ type: 'text', ...segment })) }], item.id);
  } else if (item.kind === 'legacy-ambiguous') {
    assert.equal(prepareMarkdownContent(item.markdown), item.markdown, item.id);
    assert.deepEqual(item.readingSegments, item.segments, item.id);
  } else if (item.kind === 'operation') {
    const length = item.segments.reduce((sum: number, segment: { text: string }) => sum + segment.text.length, 0);
    assert.ok(item.selection.anchor <= length && item.selection.focus <= length, item.id);
    assert.equal(item.segments.map((s: {text: string}) => s.text).join(''), item.expectedSegments.map((s: {text: string}) => s.text).join(''), item.id);
  }
}
// 独立测试契约，不改变旧 v7 覆盖范围或旧消费者基线。
const old = JSON.parse(readFileSync('contracts/markdown-editor-roundtrip-v7-fixtures.json', 'utf8'));
assert.equal(old.editCases.length, 48);
for (const client of ['wenyousite-frontend', 'wenyousite-mobile']) {
  for (const [filename, expected] of [[name, source], [schemaName, schemaSource]]) {
    const path = resolve('..', client, 'contracts', filename);
    if (existsSync(path)) assert.equal(readFileSync(path, 'utf8'), expected, `${client}/${filename} 漂移`);
  }
}
console.log(`Inline combinations contract passed: 32 mark sets, 1024 ordered pairs, ${fixture.cases.length} explicit cases`);
