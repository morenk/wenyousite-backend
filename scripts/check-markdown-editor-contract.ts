/** 校验编辑器结构化往返/源码保留黄金语料及客户端同步状态。 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type JsonObject = Record<string, unknown>;

const fixturePath = 'contracts/markdown-editor-roundtrip-v1-fixtures.json';
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureSource) as JsonObject;
const failures: string[] = [];

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

if (
  fixture.contract !== 'wenyousite-markdown-editor-roundtrip' ||
  fixture.version !== 1 ||
  fixture.markdownContractVersion !== 2
) {
  failures.push('编辑器往返语料的契约标识或版本无效');
}

const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
const ids = cases
  .map((item) => (isObject(item) ? item.id : undefined))
  .filter((id): id is string => typeof id === 'string' && id.length > 0);
if (cases.length === 0 || ids.length !== cases.length || new Set(ids).size !== ids.length) {
  failures.push('case 必须存在且 id 唯一');
}

const coveredCapabilities = new Set<string>();
const coveredModes = new Set<string>();
for (const item of cases) {
  if (!isObject(item) || typeof item.id !== 'string') continue;
  if (typeof item.markdown !== 'string' || typeof item.serialized !== 'string') {
    failures.push(`${item.id}: markdown 和 serialized 必须是字符串`);
  }
  if (item.mode !== 'structured' && item.mode !== 'source-preserve') {
    failures.push(`${item.id}: mode 必须是 structured 或 source-preserve`);
  } else {
    coveredModes.add(item.mode);
  }
  if (!Array.isArray(item.capabilities) || item.capabilities.length === 0) {
    failures.push(`${item.id}: capabilities 必须是非空数组`);
    continue;
  }
  for (const capability of item.capabilities) {
    if (typeof capability !== 'string' || capability.length === 0) {
      failures.push(`${item.id}: capability 必须是非空字符串`);
    } else {
      coveredCapabilities.add(capability);
    }
  }
}

for (const capability of [
  'bold',
  'italic',
  'strikethrough',
  'inline-code',
  'link',
  'heading',
  'quote',
  'bullet-list',
  'ordered-list',
  'hr',
  'task-list',
  'code-block',
  'table',
]) {
  if (!coveredCapabilities.has(capability)) failures.push(`缺少 ${capability} 编辑器样例`);
}
for (const mode of ['structured', 'source-preserve']) {
  if (!coveredModes.has(mode)) failures.push(`缺少 ${mode} 模式样例`);
}

for (const client of ['wenyousite-frontend', 'wenyousite-mobile']) {
  const clientFixture = path.resolve(`../${client}`, fixturePath);
  if (fs.existsSync(clientFixture) && fs.readFileSync(clientFixture, 'utf8') !== fixtureSource) {
    failures.push(`${client} 的编辑器往返语料与后端不一致`);
  }
}

if (failures.length > 0) {
  throw new Error(`Markdown editor contract checks failed:\n${failures.join('\n')}`);
}
console.log(`Markdown editor contract is valid (${cases.length} cases)`);
