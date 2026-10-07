import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { mkdtempSync, chmodSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertIsolatedEnvironment } from './e2e-guard';
import { cleanEnvironment } from './e2e-resources';
import { resourceDiagnostic, suiteFailureDiagnostic } from './e2e-runner-diagnostics';
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

test('子进程失败只公开有限错误码与本轮受控脚本行号', () => {
  const script = 'auth-terminal-e2e.ts';
  const privateLog = `Error: Command failed: pnpm exec prisma migrate deploy
PrismaClientKnownRequestError: P3018 Database error code: 42501
postgresql://private-user:private-password@private-host/private-db
at deployMigrations (/private-root/scripts/${script}:95:15)
at unrelated (/secret/secret-file.ts:123:45)
Authorization Bearer private-token
ERR_PNPM_PRIVATE_SECRET`;
  const result = suiteFailureDiagnostic(
    'e2e_' + 'a'.repeat(24),
    script,
    1,
    privateLog,
    new Set([script]),
  );
  assert.deepEqual(result.codes, ['P3018', '42501']);
  assert.deepEqual(result.source, [{ line: 95, column: 15 }]);
  assert.equal(result.errorType, 'PrismaClientKnownRequestError');
  assert.equal(result.category, 'package-manager');
  assert.equal(result.script, script);
  for (const secret of [
    'private-user',
    'private-password',
    'private-host',
    'private-db',
    'private-root',
    'private-token',
    'PRIVATE_SECRET',
    'secret-file',
    'postgresql://',
  ])
    assert(!JSON.stringify(result).includes(secret));
});

test('任意异常名、未登记脚本、连接错误正文都不能进入公开摘要', () => {
  const result = suiteFailureDiagnostic(
    'private-run-secret',
    '/private-script.ts',
    999999,
    'PrivateSecretError: ERR_PNPM_PRIVATE_SECRET P9999 postgresql://secret ERR_TOKEN_SECRET at /private-script.ts:1:1',
    new Set(['auth-terminal-e2e.ts']),
  );
  assert.equal(result.runId, 'unknown');
  assert.equal(result.script, 'unknown');
  assert.equal(result.exitCode, null);
  assert.equal(result.errorType, 'UnknownError');
  assert.deepEqual(result.codes, []);
  assert.deepEqual(result.source, []);
  assert(!JSON.stringify(result).includes('secret'));
});

test('启动失败和合法 pnpm 错误可分类，超长私有日志只检查有限尾部', () => {
  const script = 'auth-terminal-e2e.ts',
    allowed = new Set([script]),
    runId = 'e2e_' + 'a'.repeat(24);
  assert.equal(
    suiteFailureDiagnostic(runId, script, 1, 'Error: spawnSync pnpm ENOENT', allowed).category,
    'process-start',
  );
  assert.deepEqual(
    suiteFailureDiagnostic(runId, script, 1, 'ERR_PNPM_BAD_PM_VERSION', allowed).codes,
    ['ERR_PNPM_BAD_PM_VERSION'],
  );
  const result = suiteFailureDiagnostic(
    runId,
    script,
    1,
    'P1000' + 'x'.repeat(140000) + '\nTypeError: hidden',
    allowed,
  );
  assert.equal(result.errorType, 'TypeError');
  assert.deepEqual(result.codes, []);
});

test('资源审计事件仅选择身份字段，不序列化凭据或额外数据', () => {
  const identity = {
    runId: 'e2e_' + 'a'.repeat(24),
    uid: 1002,
    root: '/tmp/owned-fixture',
    password: 'root-secret',
  };
  const verified = {
    pgPort: 40001,
    redisPort: 40002,
    redisInstance: 'b'.repeat(40),
    redisPassword: 'redis-secret',
    databaseUrl: 'postgresql://secret',
  };
  const started = resourceDiagnostic('resources-verified', identity, verified);
  const cleaned = resourceDiagnostic('resources-cleaned', identity, verified);
  assert.equal(started.event, 'resources-verified');
  assert.equal(started.pgPort, 40001);
  assert.equal(cleaned.resourcesCleaned, true);
  assert.equal(cleaned.resourcesVerified, true);
  assert.equal(resourceDiagnostic('resources-cleaned', identity).resourcesVerified, false);
  assert(!JSON.stringify([started, cleaned]).includes('secret'));
});
