import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanEnvironment } from './e2e-resources';

export async function consumerFailureCase() {
  const env = {
    ...cleanEnvironment(),
    ...Object.fromEntries(
      ['E2E_PG_BIN', 'E2E_REDIS_BIN', 'E2E_LIBRARY_PATH'].map((key) => [key, process.env[key]]),
    ),
  };
  const runner = spawn(
    process.execPath,
    [
      '--import',
      require.resolve('tsx'),
      resolve('scripts/e2e-runner.ts'),
      '--source',
      '--',
      process.execPath,
      resolve('scripts/e2e-consumer-diagnostics.fixture.cjs'),
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  runner.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  runner.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  const timeout = setTimeout(() => runner.kill('SIGTERM'), 180000);
  let code: number | null;
  try {
    code = await new Promise<number | null>((resolve, reject) => {
      runner.once('error', reject);
      runner.once('exit', resolve);
    });
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(code, 1, '消费者非零退出必须让 runner 验收失败');
  const events = output.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
  const verified = events.find((row) => row.event === 'resources-verified');
  const failed = events.find((row) => row.event === 'consumer-failed');
  const cleaned = events.find((row) => row.event === 'resources-cleaned');
  assert(verified && failed && cleaned);
  assert.equal(verified.runId, failed.runId);
  assert.equal(verified.runId, cleaned.runId);
  assert.equal(cleaned.resourcesCleaned, true);
  assert.equal(cleaned.resourcesVerified, true);
  assert(!existsSync(String(verified.root)));
  const path = String(failed.diagnosticPath);
  assert.equal(path, `/tmp/wenyousite-e2e-consumer-failure-${verified.runId}.json`);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const text = readFileSync(path, 'utf8');
  assert(!text.includes('_SECRET'));
  const summary = JSON.parse(text) as {
    exitCode: number;
    records: Array<{ requestId: string; statusCode: number }>;
  };
  assert.equal(summary.exitCode, 23);
  assert(
    summary.records.some(
      (row) => row.requestId === '6f0de6c4-254b-4490-89bb-835d5566d751' && row.statusCode === 401,
    ),
    '摘要必须解析到实际 Nest/pino-pretty 异常记录',
  );
  console.log(
    JSON.stringify({
      event: 'consumer-diagnostic-verified',
      runId: verified.runId,
      diagnosticPath: path,
      resourcesCleaned: true,
    }),
  );
}
if (require.main === module)
  void consumerFailureCase().catch(() => {
    console.error('消费者诊断真实链路未通过');
    process.exitCode = 1;
  });
