import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { mkdtempSync, chmodSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertIsolatedEnvironment } from './e2e-guard';
import { cleanEnvironment } from './e2e-resources';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'e2e-guard-test-'));
  const runId = `e2e_${'a'.repeat(24)}`;
  const path = join(root, 'manifest.json');
  const resourcesPath = join(root, 'resources.json');
  const manifest = { privateEnvPath: join(root, 'private.env.json'), uploadPath: join(root, 'uploads'), version: 1, state: 'ready', runId, backendURL: 'http://127.0.0.1:39003', apiBase: 'http://127.0.0.1:39003/api/v1', resourcesPath,
    postgres: { host: '127.0.0.1', port: 39001, database: `wenyousite_${runId}`, clusterName: runId },
    redis: { host: '127.0.0.1', port: 39002, instanceId: 'redis-test-instance' },
  };
  writeFileSync(path, JSON.stringify(manifest), { mode: 0o600 });
  writeFileSync(join(root, 'ownership.json'), JSON.stringify({ runId, root, uid: process.getuid?.() }));
  writeFileSync(resourcesPath, JSON.stringify({ runId, root, pgPort: 39001, redisPort: 39002, redisInstance: 'redis-test-instance' }));
  const databaseUrl = `postgresql://e2e_owner:unused@127.0.0.1:39001/wenyousite_${runId}`;
  const env: NodeJS.ProcessEnv = { E2E_MANIFEST: path, E2E_RUN_ID: runId, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl,
    REDIS_HOST: '127.0.0.1', REDIS_PORT: '39002', REDIS_DB: '0', REDIS_PASSWORD: 'unused', NODE_ENV: 'test', PUSH_ENABLED: 'false', API_BASE: manifest.apiBase };
  return { root, path, manifest, env, close: () => rmSync(root, { recursive: true }) };
}
test('拒绝旧环境标记与 loopback 名称伪装，且不需要连接数据库', () => {
  assert.throws(() => assertIsolatedEnvironment({ DATABASE_URL: 'postgresql://owner:unused@127.0.0.1:5432/wenyousite_e2e_fake', API_E2E_ENV: 'test' }), /runner/);
});
for (const [name, override] of [
  ['线上端口', { DATABASE_URL: 'postgresql://e2e_owner:unused@127.0.0.1:5432/postgres' }],
  ['旧 Redis DB 15', { REDIS_DB: '15' }], ['外部 Redis', { REDIS_HOST: 'wenyou.site' }],
  ['线上 API', { API_BASE: 'https://wenyou.site/api/v1' }], ['错 runId', { E2E_RUN_ID: `e2e_${'b'.repeat(24)}` }],
  ['继承 migration 凭据', { DIRECT_DATABASE_URL: 'postgresql://owner:unused@127.0.0.1:5432/wenyousite' }],
  ['推送', { PUSH_ENABLED: 'true' }], ['SMTP 凭据', { SES_SMTP_PASS: 'not-a-real-secret' }],
  ['外部对象存储', { COS_ENDPOINT: 'https://example.invalid' }],
] as const) test(`拒绝${name}`, () => {
  const f = fixture(); try { assert.throws(() => assertIsolatedEnvironment({ ...f.env, ...override })); } finally { f.close(); }
});
test('仅完整登记通过；宽松权限和资源漂移拒绝', () => {
  const f = fixture(); try {
    assert.equal(assertIsolatedEnvironment(f.env).runId, f.env.E2E_RUN_ID);
    chmodSync(f.path, 0o644); assert.throws(() => assertIsolatedEnvironment(f.env), /私有/);
    chmodSync(f.path, 0o600);
    writeFileSync(f.manifest.resourcesPath, JSON.stringify({ runId: 'other' }));
    assert.throws(() => assertIsolatedEnvironment(f.env), /漂移/);
  } finally { f.close(); }
});
test('子进程白名单环境丢弃线上连接、NODE_OPTIONS 及外部凭据', () => {
  const values = { DATABASE_URL: 'unused', REDIS_PASSWORD: 'unused', NODE_OPTIONS: '--bad', SES_SMTP_PASS: 'unused', GOOGLE_APPLICATION_CREDENTIALS: '/unused' };
  const before = { ...process.env };
  try {
    Object.assign(process.env, values);
    const env = cleanEnvironment();
    for (const key of Object.keys(values)) assert.equal(env[key], undefined);
  } finally { process.env = before; }
});

test('非法 URL 与损坏私有登记不会回显敏感输入', () => {
  const f = fixture(); try {
    const marker = 'private-input-must-not-appear';
    assert.throws(() => assertIsolatedEnvironment({ ...f.env, DATABASE_URL: marker }), (error: Error) => !error.message.includes(marker));
    writeFileSync(f.path, marker);
    assert.throws(() => assertIsolatedEnvironment(f.env), (error: Error) => !error.message.includes(marker));
  } finally { f.close(); }
});


test('管理员会话原始入口拒绝旧手工环境，先于数据库和迁移操作退出', () => {
  const result = spawnSync(process.execPath, [
    '--require', require.resolve('ts-node/register/transpile-only'),
    join(__dirname, 'admin-session.integration.ts'),
  ], {
    cwd: join(__dirname, '..'),
    env: { ...cleanEnvironment(), ADMIN_SESSION_TEST_ENV: 'test',
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /runner/);
  assert.doesNotMatch(result.stderr, /PrismaClientInitializationError|Can't reach database/);
});
