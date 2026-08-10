import * as fs from 'node:fs';

const coveragePath = 'contracts/mobile-v1-operation-coverage.json';
const fixturePath = 'contracts/mobile-v1-golden-fixtures.json';
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8')) as Record<string, any>;
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, any>;
const failures: string[] = [];

const expectedCounts = { total: 196, v1: 92, deferred: 54, notApplicable: 49, infrastructure: 1 };
for (const [name, expected] of Object.entries(expectedCounts)) {
  if (coverage.counts?.[name] !== expected) {
    failures.push(
      `coverage.counts.${name} 应为 ${expected}，实际为 ${String(coverage.counts?.[name])}`,
    );
  }
}

const rows = Array.isArray(coverage.operations) ? coverage.operations : [];
const seen = new Set<string>();
for (const row of rows) {
  if (seen.has(row.operationId)) failures.push(`重复分类 operationId: ${row.operationId}`);
  seen.add(row.operationId);
  if (!['v1', 'deferred', 'not_applicable', 'infrastructure'].includes(row.disposition)) {
    failures.push(`${row.operationId}: disposition 无效`);
  }
  if (!['implemented', 'planned', 'deferred', 'not_applicable'].includes(row.status)) {
    failures.push(`${row.operationId}: status 无效`);
  }
  if (row.disposition === 'v1' && !['implemented', 'planned'].includes(row.status)) {
    failures.push(`${row.operationId}: V1 操作只能是 implemented/planned`);
  }
  if (row.disposition === 'deferred' && row.status !== 'deferred') {
    failures.push(`${row.operationId}: deferred 操作状态不一致`);
  }
  if (
    ['not_applicable', 'infrastructure'].includes(row.disposition) &&
    row.status !== 'not_applicable'
  ) {
    failures.push(`${row.operationId}: 非移动功能状态必须为 not_applicable`);
  }
  if (row.status === 'implemented' && (!Array.isArray(row.evidence) || row.evidence.length === 0)) {
    failures.push(`${row.operationId}: implemented 缺少自动测试证据`);
  }
}

if (coverage.contractVersion !== fixture.contractVersion) {
  failures.push('coverage 与黄金 fixture 的 contractVersion 不一致');
}
for (const section of [
  'compatibility',
  'authentication',
  'retry',
  'pagination',
  'categories',
  'media',
  'idempotency',
  'unknownEnums',
]) {
  if (!Array.isArray(fixture[section]) || fixture[section].length === 0) {
    failures.push(`黄金 fixture 缺少 ${section} 用例`);
  }
}
const caseIds = Object.values(fixture)
  .filter(Array.isArray)
  .flatMap((cases: any[]) => cases.map((item) => item?.id));
if (caseIds.some((id) => typeof id !== 'string') || new Set(caseIds).size !== caseIds.length) {
  failures.push('黄金 fixture case id 必须存在且全局唯一');
}

if (failures.length > 0) throw new Error(`移动端 V1 契约检查失败：\n${failures.join('\n')}`);
console.log(
  `Mobile V1 contract is valid (${rows.length} classified operations, ${caseIds.length} golden cases)`,
);
