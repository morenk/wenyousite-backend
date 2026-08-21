import * as fs from 'node:fs';

const coveragePath = 'contracts/mobile-v1-operation-coverage.json';
const fixturePath = 'contracts/mobile-v1-golden-fixtures.json';
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8')) as Record<string, any>;
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Record<string, any>;
const failures: string[] = [];

const expectedCounts = { total: 204, v1: 97, deferred: 56, notApplicable: 50, infrastructure: 1 };
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
  'momentCommentNavigation',
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
const momentNavigationCases = new Map(
  (fixture.momentCommentNavigation as Array<Record<string, any>>).map((item) => [item.id, item]),
);
for (const id of [
  'moment-comment-root-target',
  'moment-comment-reply-target',
  'moment-comment-tombstone-root',
  'moment-comment-target-unavailable',
  'moment-comment-context-transient-failure',
]) {
  if (!momentNavigationCases.has(id)) failures.push(`黄金 fixture 缺少动态评论定位用例 ${id}`);
}
const rootTarget = momentNavigationCases.get('moment-comment-root-target');
if (
  rootTarget?.contextRequest?.operationId !== 'momentsCommentContext' ||
  rootTarget?.contextResponse?.rootId !== rootTarget?.contextResponse?.targetId ||
  rootTarget?.expected?.scanPagination !== false
) {
  failures.push('moment-comment-root-target 必须直接注入并定位主评论且不得扫描分页');
}
const replyTarget = momentNavigationCases.get('moment-comment-reply-target');
if (
  replyTarget?.contextResponse?.targetParentCommentId !== replyTarget?.contextResponse?.rootId ||
  replyTarget?.expected?.injectTargetReply !== true ||
  replyTarget?.expected?.expandReplies !== true ||
  replyTarget?.expected?.scanPagination !== false
) {
  failures.push('moment-comment-reply-target 必须注入所属主评论与目标楼中楼且不得扫描分页');
}
const tombstoneRoot = momentNavigationCases.get('moment-comment-tombstone-root');
if (
  tombstoneRoot?.contextResponse?.rootDeleted !== true ||
  tombstoneRoot?.expected?.preserveRootTombstone !== true
) {
  failures.push('moment-comment-tombstone-root 必须保留已删除主评论墓碑上下文');
}
const unavailableTarget = momentNavigationCases.get('moment-comment-target-unavailable');
if (
  unavailableTarget?.httpStatus !== 404 ||
  unavailableTarget?.expected?.keepMomentDetail !== true ||
  unavailableTarget?.expected?.retryContext !== false
) {
  failures.push('moment-comment-target-unavailable 必须保留动态详情且不自动重试定位');
}
const transientFailure = momentNavigationCases.get('moment-comment-context-transient-failure');
if (
  transientFailure?.httpStatus !== 503 ||
  transientFailure?.expected?.keepMomentDetail !== true ||
  transientFailure?.expected?.retryContext !== true
) {
  failures.push('moment-comment-context-transient-failure 必须保留动态详情并允许重试定位');
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
