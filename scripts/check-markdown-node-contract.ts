/** 校验 Markdown v3 扩展节点黄金语料的结构、覆盖面和客户端同步状态。 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type JsonObject = Record<string, unknown>;

const fixturePath = 'contracts/markdown-v3-nodes-fixtures.json';
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureSource) as JsonObject;
const failures: string[] = [];

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

if (
  fixture.contract !== 'wenyousite-markdown-nodes' ||
  fixture.version !== 1 ||
  fixture.markdownContractVersion !== 3
) {
  failures.push('扩展节点语料的契约标识或版本无效');
}

const cases = Array.isArray(fixture.cases) ? fixture.cases : [];
const caseIds = cases
  .map((item) => isObject(item) ? item.id : undefined)
  .filter((id): id is string => typeof id === 'string');
if (cases.length === 0 || caseIds.length !== cases.length || new Set(caseIds).size !== caseIds.length) {
  failures.push('case 必须存在且 id 唯一');
}

const coveredNodeTypes = new Set<string>();
for (const item of cases) {
  if (!isObject(item) || !isNonEmptyString(item.id)) continue;
  if (typeof item.markdown !== 'string' || typeof item.serialized !== 'string') {
    failures.push(`${item.id}: markdown 和 serialized 必须是字符串`);
  }
  if (!Array.isArray(item.nodes)) {
    failures.push(`${item.id}: nodes 必须是数组`);
    continue;
  }
  for (const node of item.nodes) {
    if (!isObject(node) || !isNonEmptyString(node.type)) {
      failures.push(`${item.id}: 节点必须包含 type`);
      continue;
    }
    coveredNodeTypes.add(node.type);
    if (node.type === 'mention' && (!isNonEmptyString(node.userId) || !isNonEmptyString(node.label))) {
      failures.push(`${item.id}: mention 必须包含 userId 和 label`);
    } else if (node.type === 'mention_all_players' && !isNonEmptyString(node.label)) {
      failures.push(`${item.id}: mention_all_players 必须包含 label`);
    } else if (node.type === 'dice' && (!isNonEmptyString(node.nodeId) || !isNonEmptyString(node.notation))) {
      failures.push(`${item.id}: dice 必须包含 nodeId 和 notation`);
    } else if (node.type === 'sticker' && (
      !isNonEmptyString(node.assetId) ||
      !isNonEmptyString(node.url) ||
      !isNonEmptyString(node.alt)
    )) {
      failures.push(`${item.id}: sticker 必须包含 assetId、url 和 alt`);
    } else if (node.type === 'image' && (
      !isNonEmptyString(node.url) ||
      typeof node.alt !== 'string' ||
      !(node.title === null || typeof node.title === 'string')
    )) {
      failures.push(`${item.id}: image 必须包含 url、alt 和可空 title`);
    } else if (!['mention', 'mention_all_players', 'dice', 'sticker', 'image'].includes(node.type)) {
      failures.push(`${item.id}: 未知节点类型 ${node.type}`);
    }
  }
}

for (const nodeType of ['mention', 'mention_all_players', 'dice', 'sticker', 'image']) {
  if (!coveredNodeTypes.has(nodeType)) failures.push(`缺少 ${nodeType} 节点样例`);
}
for (const boundaryId of ['inline-code-boundary', 'escaped-markers']) {
  const boundary = cases.find((item) => isObject(item) && item.id === boundaryId);
  if (!isObject(boundary) || !Array.isArray(boundary.nodes) || boundary.nodes.length !== 0) {
    failures.push(`${boundaryId} 必须存在且不得解析出节点`);
  }
}

const identityRules = Array.isArray(fixture.identityRules) ? fixture.identityRules : [];
const identityKeys = identityRules.map((rule) => isObject(rule)
  ? `${String(rule.nodeType)}:${String(rule.operation)}:${String(rule.field)}`
  : 'invalid');
if (identityRules.length === 0 || new Set(identityKeys).size !== identityKeys.length) {
  failures.push('identityRules 必须存在且规则键唯一');
}
const requiredIdentityRules = [
  'dice:copy_paste:nodeId:regenerate',
  'dice:cut_paste:nodeId:preserve',
  'mention:copy_paste:userId:preserve',
  'sticker:copy_paste:assetId:preserve',
  'image:copy_paste:null:no_identity',
];
const actualIdentityRules = new Set(identityRules.map((rule) => isObject(rule)
  ? `${String(rule.nodeType)}:${String(rule.operation)}:${String(rule.field)}:${String(rule.result)}`
  : 'invalid'));
for (const rule of requiredIdentityRules) {
  if (!actualIdentityRules.has(rule)) failures.push(`缺少复制身份规则 ${rule}`);
}

const frontendFixture = path.resolve('../wenyousite-frontend', fixturePath);
if (fs.existsSync(frontendFixture) && fs.readFileSync(frontendFixture, 'utf8') !== fixtureSource) {
  failures.push('前后端 Markdown v3 扩展节点语料不一致');
}

if (failures.length > 0) {
  throw new Error(`Markdown node contract checks failed:\n${failures.join('\n')}`);
}
console.log(
  `Markdown node contract is valid (${cases.length} cases, ${identityRules.length} identity rules)`,
);
