import * as fs from 'node:fs';

const coveragePath = 'contracts/mobile-v1-operation-coverage.json';
const fixturePath = 'contracts/mobile-v1-golden-fixtures.json';
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8')) as Record<string, any>;
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, any>;
const failures: string[] = [];

const expectedCounts = { total: 203, v1: 96, deferred: 56, notApplicable: 50, infrastructure: 1 };
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
  'profileCovers',
  'idempotency',
  'unknownEnums',
]) {
  if (!Array.isArray(fixture[section]) || fixture[section].length === 0) {
    failures.push(`黄金 fixture 缺少 ${section} 用例`);
  }
}

const profileCoverCases = new Map(
  (fixture.profileCovers as Array<Record<string, any>>).map((item) => [item.id, item]),
);
for (const id of [
  'profile-cover-mobile-present',
  'profile-cover-mobile-missing',
  'profile-cover-empty',
  'profile-cover-dual-write',
  'profile-cover-legacy-write',
  'profile-cover-remove',
]) {
  if (!profileCoverCases.has(id)) failures.push(`黄金 fixture 缺少双画幅用例 ${id}`);
}
const mobilePresent = profileCoverCases.get('profile-cover-mobile-present');
if (
  mobilePresent?.profileCover?.width / mobilePresent?.profileCover?.height !== 3 ||
  mobilePresent?.profileCover?.mobile?.width / mobilePresent?.profileCover?.mobile?.height !== 2 ||
  mobilePresent?.expectedSurface !== 'mobile'
) {
  failures.push('profile-cover-mobile-present 必须固定 Web 3:1、移动端 2:1 与移动优先');
}
const mobileMissing = profileCoverCases.get('profile-cover-mobile-missing');
if (mobileMissing?.profileCover?.mobile !== null || mobileMissing?.expectedSurface !== 'web') {
  failures.push('profile-cover-mobile-missing 必须固定移动裁切为空时回退 Web');
}
const dualWrite = profileCoverCases.get('profile-cover-dual-write');
if (!dualWrite?.request?.mediaId || !dualWrite?.request?.mobileMediaId) {
  failures.push('profile-cover-dual-write 必须同时包含 Web 与移动 mediaId');
}
const legacyWrite = profileCoverCases.get('profile-cover-legacy-write');
if (!legacyWrite?.request?.mediaId || 'mobileMediaId' in (legacyWrite?.request ?? {})) {
  failures.push('profile-cover-legacy-write 必须固定省略 mobileMediaId 的旧请求');
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
