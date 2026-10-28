import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { consumerFailureDiagnostic, preserveConsumerDiagnostic } from './e2e-consumer-diagnostics';
const runId = 'e2e_' + 'a'.repeat(24);
const row = {
  context: 'AllExceptionsFilter',
  method: 'PATCH',
  route: '/api/v1/threads/:id/aggregate',
  statusCode: 500,
  requestId: '03cf9a39-ceb7-4844-9063-02da924c7cf2',
  errorType: 'PrismaClientKnownRequestError',
  prismaCode: 'P2028',
  dbOperation: 'thread.aggregate.save',
  dbStage: 'commit',
  dbElapsedMs: 5234,
};
test('消费者失败保留关联字段，丢弃 SQL、凭证、私密正文及所有任意字段', () => {
  const log =
    '\u001b[31m[12:34:56] ERROR: ' +
    JSON.stringify({
      ...row,
      message: 'MESSAGE_SECRET\nSELECT SQL_SECRET',
      req: { cookie: 'COOKIE_SECRET', body: 'BODY_SECRET' },
      meta: { code: 'META_SECRET' },
      stack: 'STACK_SECRET',
      sqlState: 'STATE_SECRET',
    }) +
    '\n' +
    JSON.stringify({
      ...row,
      prismaCode: 'CODE_SECRET',
      requestId: 'ID_SECRET',
      dbStage: 'STAGE_SECRET',
      route: '/private/ROUTE_SECRET',
      method: 'METHOD_SECRET',
      errorType: 'TYPE_SECRET',
      dbElapsedMs: 'TIME_SECRET',
    });
  const result = consumerFailureDiagnostic(runId, 23, log);
  assert.deepEqual(
    result.records[0],
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'context')),
  );
  assert(!JSON.stringify(result).includes('_SECRET'));
  assert.equal(consumerFailureDiagnostic('SECRET', null, 'malformed SECRET').records.length, 0);
});
test('保存为0600新文件，清理输入后仍保留摘要；不覆盖旧证据', async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2e-diagnostics-test-'));
  try {
    const input = join(root, 'api.log'),
      output = join(root, 'summary.json');
    writeFileSync(input, JSON.stringify(row));
    await preserveConsumerDiagnostic(runId, 23, input, output);
    rmSync(input);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).records[0].prismaCode, 'P2028');
    writeFileSync(input, 'SECRET');
    await assert.rejects(() => preserveConsumerDiagnostic(runId, 1, input, output), {
      code: 'EEXIST',
    });
  } finally {
    rmSync(root, { recursive: true });
  }
});
test('仅保存最近100条过滤器记录，不把普通日志或损坏行解释为异常', () => {
  const log =
    Array.from({ length: 110 }, () => JSON.stringify(row)).join('\n') +
    '\n' +
    JSON.stringify({ ...row, context: 'other' });
  const result = consumerFailureDiagnostic(runId, 1, log);
  assert.equal(result.records.length, 100);
  assert.equal(result.omittedRecords, 10);
});

test('后续大量4xx不能挤掉较早的500诊断', () => {
  const log = [
    JSON.stringify(row),
    ...Array.from({ length: 200 }, () =>
      JSON.stringify({ ...row, statusCode: 401, prismaCode: undefined }),
    ),
  ].join('\n');
  const result = consumerFailureDiagnostic(runId, 1, log);
  assert.equal(result.records.length, 100);
  assert.equal(result.records[0].prismaCode, 'P2028');
  assert.equal(result.omittedRecords, 101);
});
