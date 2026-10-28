const assert = require('node:assert/strict');
const { readFileSync, lstatSync } = require('node:fs');
const requestId = '6f0de6c4-254b-4490-89bb-835d5566d751';
(async () => {
  const manifest = JSON.parse(readFileSync(process.env.E2E_MANIFEST, 'utf8'));
  assert.equal(lstatSync(process.env.E2E_MANIFEST).mode & 0o777, 0o600);
  assert.equal(manifest.runId, process.env.E2E_RUN_ID);
  assert.equal(manifest.apiBase, process.env.API_BASE);
  const target = new URL(manifest.apiBase);
  assert.equal(target.hostname, '127.0.0.1');
  assert.notEqual(target.port, '3000');
  // Guard 拒绝发生于业务写入之前；正文与凭证标记不得进入留存摘要。
  const response = await fetch(target + '/threads/00000000-0000-4000-8000-000000000001/aggregate', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      authorization: 'Bearer TOKEN_SECRET',
    },
    body: JSON.stringify({ content: 'BODY_SECRET', cookie: 'COOKIE_SECRET' }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('x-request-id'), requestId);
  await response.arrayBuffer();
  process.exitCode = 23;
})().catch(() => {
  process.exitCode = 24;
});
