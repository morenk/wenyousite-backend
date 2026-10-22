const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const Ajv = require('ajv');
const { snapshotOf, policyOf } = require('./runtime-policy.cjs');
const root = resolve(__dirname, '../..');
const read = (name) => JSON.parse(readFileSync(resolve(root, 'contracts/' + name)));
const manifestBytes = readFileSync(resolve(root, 'contracts/thread-font-manifest-v1.json'));
const manifest = JSON.parse(manifestBytes);
const policy = read('thread-font-runtime-policy-v2.json');
const fixture = read('thread-font-runtime-policy-v2-fixtures.json');
const validate = new Ajv({ allErrors: true }).compile(read('thread-font-runtime-policy-v2.schema.json'));
execFileSync(process.execPath, [resolve(__dirname, 'generate-runtime-policy.cjs'), '--check']);
assert(validate(policy), JSON.stringify(validate.errors));
assert.deepEqual(policy, policyOf(manifestBytes));
assert.equal(policy.manifestSha256, fixture.manifestSha256);
assert.deepEqual(manifest.limits, fixture.legacyLimits);
for (const row of fixture.invalidPolicies) {
  const changed = structuredClone(policy), keys = row.path.split('.');
  let target = changed;
  for (const key of keys.slice(0, -1)) target = target[key];
  target[keys.at(-1)] = row.value;
  assert(!validate(changed), 'invalid policy accepted: ' + row.path);
}
assert(!validate({ ...policy, unreviewed: true }));
for (const platform of ['web', 'mobile']) {
  for (const field of ['timeoutMode', 'maxTransferMs']) {
    const prototype = structuredClone(policy);
    delete prototype[platform].network[field];
    assert(!validate(prototype), 'old prototype must not silently acquire idle timeout semantics');
  }
}
const count = policy.mobile.registration.snapshot;
assert.deepEqual(snapshotOf(manifest), count);
const repeated = structuredClone(manifest);
repeated.fonts[0].shards.push(structuredClone(repeated.fonts[0].shards[0]));
assert.deepEqual(snapshotOf(repeated), count, 'duplicate descriptor must not double count');
repeated.fonts[0].shards.at(-1).family += '-alias';
const alias = snapshotOf(repeated);
assert.equal(alias.assetCount, count.assetCount);
assert.equal(alias.totalAssetBytes, count.totalAssetBytes);
assert.equal(alias.registrationCount, count.registrationCount + 1);
assert(alias.totalRegistrationAssetBytes > count.totalRegistrationAssetBytes);
repeated.fonts[0].shards.at(-1).mobile.bytes++;
assert.throws(() => snapshotOf(repeated), /identity_conflict/);
const source = manifest.fonts[0].shards[0];
const overflow = { fonts: [{ availability: 'ready', shards: Array.from({ length: 1025 }, (_, i) => ({ ...source, family: 'alias-' + i })) }] };
assert.throws(() => snapshotOf(overflow), /safety_ceiling/);
const byteOverflow = structuredClone(manifest);
byteOverflow.fonts[0].shards[0].mobile.bytes = 268435457;
assert.throws(() => snapshotOf(byteOverflow), /safety_ceiling/);
for (const row of fixture.backoffCases) {
  const ceiling = policy.retry.delayCeilingsMs[Math.min(row.failureCount, policy.retry.delayCeilingsMs.length) - 1];
  assert.equal(Math.floor(row.random * (ceiling + 1)), row.expectedDelayMs);
}
for (const row of fixture.notBeforeCases) {
  const parsed = /^\d+$/.test(row.retryAfter) ? row.nowMs + Number(row.retryAfter) * 1000 : Date.parse(row.retryAfter);
  assert.equal(Math.max(row.nowMs + row.delayMs, row.windowReadyAtMs, Number.isFinite(parsed) ? parsed : row.nowMs), row.expectedAtMs);
}
for (const row of fixture.sfntEstimateCases)
  assert.equal(Math.max(row.mobileBytes, row.verifiedWoff2TotalSfntSize), row.expectedBytes);
for (const row of fixture.windowCases)
  assert.equal(row.nowMs - row.reservedAtMs >= policy.web.network.windowMs, row.expectedExpired);
for (const row of fixture.snapshotCases)
  assert.equal(row.uniqueAssets <= policy.mobile.registration.safetyCeiling.maxSnapshotAssets && row.totalAssetBytes <= policy.mobile.registration.safetyCeiling.maxSnapshotAssetBytes ? 'accept' : 'reject', row.expected);
for (const row of fixture.activationCases)
  assert.equal(!row.baseConfigured ? 'system-fallback' : row.endpoint !== 'available' || !row.supported || !row.manifestMatches ? 'legacy' : 'v2', row.expected);

// 共享事件轨迹的时钟参考模型；消费者仍须用实际流式读取实现运行同一组夹具。
function transferResult(row, network) {
  assert(row.startedAtMs >= row.queuedAtMs);
  const events = row.events.flatMap((event) => Array.from({ length: event.repeat ?? 1 }, (_, i) => ({
    ...event, atMs: event.atMs + i * (event.everyMs ?? 0),
  }))).sort((a, b) => a.atMs - b.atMs);
  const totalDeadline = row.startedAtMs + network.maxTransferMs;
  let idleDeadline = row.startedAtMs + network.timeoutMs;
  let acceptedBytes = 0;
  const result = (outcome, atMs) => ({ outcome, atMs, acceptedBytes });
  for (const event of events) {
    assert(event.atMs >= row.startedAtMs);
    const deadline = Math.min(idleDeadline, totalDeadline);
    if (event.atMs >= deadline)
      return result(totalDeadline <= idleDeadline ? 'total-timeout' : 'idle-timeout', deadline);
    if (event.kind === 'cancel') return result('cancelled', event.atMs);
    if (event.kind === 'end') return result('complete', event.atMs);
    if (event.kind === 'data') {
      assert(Number.isSafeInteger(event.bytes) && event.bytes >= 0);
      if (event.bytes > row.byteLimit - acceptedBytes) return result('length-rejected', event.atMs);
      acceptedBytes += event.bytes;
      if (event.bytes > 0) idleDeadline = event.atMs + network.timeoutMs;
    } else assert(['headers', 'tick'].includes(event.kind));
  }
  throw new Error('transfer fixture has no terminal event: ' + row.id);
}
assert.equal(new Set(fixture.transferCases.map((row) => row.id)).size, fixture.transferCases.length);
for (const platform of ['web', 'mobile']) {
  for (const row of fixture.transferCases)
    assert.deepEqual(transferResult(row, policy[platform].network), row.expected, platform + ': ' + row.id);
}
console.log('字体运行策略 v2 通过：旧 manifest 原义、绑定快照、窗口退避、15 秒 idle / 10 分钟总限及 ' + fixture.transferCases.length + ' 个共享传输轨迹');
