/** 校验 FCM data v1 JSON Schema 和黄金样例的结构与隐私边界。 */

import Ajv from 'ajv';
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
const validatePayload = new Ajv({ allErrors: true, strict: true }).compile(schema);
for (const fixture of fixtures.validCases ?? []) {
  if (!validatePayload(fixture.payload)) {
    failures.push(`${String(fixture.id)} 应合法：${JSON.stringify(validatePayload.errors)}`);
  }
}
for (const fixture of fixtures.invalidCases ?? []) {
  if (validatePayload(fixture.payload)) {
    failures.push(`${String(fixture.id)} 应被拒绝`);
  }
}

if (failures.length > 0) {
  throw new Error(`Mobile push contract checks failed:\n${failures.join('\n')}`);
}
console.log(
  `Mobile push v1 contract is valid (${fixtures.validCases?.length ?? 0} valid, ${fixtures.invalidCases?.length ?? 0} invalid fixtures)`,
);
