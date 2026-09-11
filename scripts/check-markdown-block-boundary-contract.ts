/** 后端为块边界 fixture 唯一事实源；消费者从已提交 SHA 同步同名文件。 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { findUnsupportedMarkdownFormats, prepareMarkdownContent } from '../src/common/markdown-content';

const fixturePath = 'contracts/markdown-block-boundary-v1-fixtures.json';
const source = readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(source);
assert.equal(fixture.contract, 'wenyousite-markdown-block-boundary');
assert.equal(fixture.version, 1);
assert.equal(fixture.revision, 2);
assert.equal(fixture.markdownContractVersion, 5);
for (const group of ['cases', 'editCases', 'clipboardCases', 'whitespaceCases']) {
  const ids = new Set<string>();
  assert.ok(fixture[group].length > 0, `${group} 不得为空`);
  for (const item of fixture[group]) {
    assert.equal(typeof item.id, 'string');
    assert.ok(!ids.has(item.id), `${group}: 重复 id ${item.id}`);
    ids.add(item.id);
    assert.equal(typeof item.markdown, 'string');
    if (group === 'cases') {
      assert.equal(typeof item.supported, 'boolean');
      assert.deepEqual(findUnsupportedMarkdownFormats(item.markdown)[0] ?? null, item.error, item.id);
      assert.equal(item.supported, item.error === null, item.id);
    }
    if (item.serialized !== null) assert.equal(prepareMarkdownContent(item.serialized), item.serialized, item.id);
  }
}
for (const client of ['wenyousite-frontend', 'wenyousite-mobile']) {
  const copy = resolve(`../${client}`, fixturePath);
  if (existsSync(copy)) assert.equal(readFileSync(copy, 'utf8'), source, `${client} fixture 不一致`);
}
console.log(`Markdown block boundary contract is valid (${fixture.cases.length} cases)`);
