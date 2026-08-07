/** 校验 FCM data v1 JSON Schema 和黄金样例的结构与隐私边界。 */

import * as fs from 'node:fs';

type JsonObject = Record<string, unknown>;

const schema = JSON.parse(
  fs.readFileSync('contracts/mobile-push-v1.schema.json', 'utf8'),
) as JsonObject;
const fixtures = JSON.parse(
  fs.readFileSync('contracts/mobile-push-v1-fixtures.json', 'utf8'),
) as {
  contract?: unknown;
  version?: unknown;
  validCases?: Array<{ id?: unknown; payload?: unknown }>;
  invalidCases?: Array<{ id?: unknown; payload?: unknown }>;
};
const failures: string[] = [];

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validatePayload(value: unknown): string[] {
  if (!isObject(value)) return ['payload 必须是对象'];
  if (!Object.values(value).every((item) => typeof item === 'string')) {
    return ['FCM data 的所有值必须是字符串'];
  }
  if (value.schemaVersion !== '1') return ['schemaVersion 必须为字符串 1'];

  const expectedKeys = value.kind === 'notification'
    ? ['kind', 'notificationId', 'schemaVersion']
    : value.kind === 'direct_message'
      ? ['conversationId', 'kind', 'messageId', 'schemaVersion']
      : null;
  if (!expectedKeys) return ['kind 必须为 notification 或 direct_message'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    return ['payload 字段集与 kind 不匹配'];
  }
  for (const key of expectedKeys.filter((key) => !['kind', 'schemaVersion'].includes(key))) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      return [`${key} 必须是非空字符串`];
    }
  }
  return [];
}

if (schema.$schema !== 'http://json-schema.org/draft-07/schema#') {
  failures.push('mobile push schema 必须使用 JSON Schema draft-07');
}
if (!Array.isArray(schema.oneOf) || schema.oneOf.length !== 2) {
  failures.push('mobile push schema 必须恰好定义两种 payload');
} else {
  const expected = new Map([
    ['notification', ['schemaVersion', 'kind', 'notificationId'].sort()],
    ['direct_message', ['schemaVersion', 'kind', 'conversationId', 'messageId'].sort()],
  ]);
  for (const branch of schema.oneOf) {
    if (!isObject(branch) || !isObject(branch.properties)) {
      failures.push('mobile push schema 分支结构无效');
      continue;
    }
    const kindSchema = branch.properties.kind;
    const kind = isObject(kindSchema) ? kindSchema.const : undefined;
    const required = Array.isArray(branch.required)
      ? branch.required.filter((item): item is string => typeof item === 'string').sort()
      : [];
    if (typeof kind !== 'string' || JSON.stringify(required) !== JSON.stringify(expected.get(kind))) {
      failures.push(`mobile push schema ${String(kind)} 分支必填字段无效`);
    }
    if (branch.additionalProperties !== false) {
      failures.push(`mobile push schema ${String(kind)} 分支必须禁止额外字段`);
    }
  }
}

if (fixtures.contract !== 'wenyousite-mobile-push' || fixtures.version !== 1) {
  failures.push('mobile push fixtures 契约标识或版本无效');
}
const allCases = [...(fixtures.validCases ?? []), ...(fixtures.invalidCases ?? [])];
const caseIds = allCases.map((item) => item.id).filter((id): id is string => typeof id === 'string');
if (caseIds.length !== allCases.length || new Set(caseIds).size !== caseIds.length) {
  failures.push('mobile push fixture case id 必须存在且唯一');
}
for (const fixture of fixtures.validCases ?? []) {
  const errors = validatePayload(fixture.payload);
  if (errors.length > 0) failures.push(`${String(fixture.id)} 应合法：${errors.join('; ')}`);
}
for (const fixture of fixtures.invalidCases ?? []) {
  if (validatePayload(fixture.payload).length === 0) {
    failures.push(`${String(fixture.id)} 应被拒绝`);
  }
}

if (failures.length > 0) {
  throw new Error(`Mobile push contract checks failed:\n${failures.join('\n')}`);
}
console.log(
  `Mobile push v1 contract is valid (${fixtures.validCases?.length ?? 0} valid, ${fixtures.invalidCases?.length ?? 0} invalid fixtures)`,
);
