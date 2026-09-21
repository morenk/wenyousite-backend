import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const env = process.env;
assert(env.E2E_MANIFEST && env.E2E_PRIVATE_ENV && env.E2E_RUN_ID);
assert.equal(statSync(env.E2E_PRIVATE_ENV).mode & 0o777, 0o600);
assert.equal(statSync(dirname(env.E2E_MANIFEST)).mode & 0o777, 0o700);
const manifest = JSON.parse(readFileSync(env.E2E_MANIFEST, 'utf8'));
const account = JSON.parse(readFileSync(env.E2E_PRIVATE_ENV, 'utf8'));
assert.equal(manifest.runId, env.E2E_RUN_ID);
assert.equal(account.E2E_RUN_ID, manifest.runId);
assert.equal(manifest.backendURL, env.E2E_BACKEND_URL);
assert.equal(manifest.apiBase, env.API_BASE);
const origin = new URL(manifest.backendURL);
assert.equal(origin.hostname, '127.0.0.1');
assert(origin.port && origin.port !== '3000');
for (const key of ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'REDIS_PASSWORD', 'JWT_ACCESS_SECRET', 'SES_SMTP_PASS']) {
  assert.equal(env[key], undefined);
  assert.equal(account[key], undefined);
}
// 正常公开接口核对随机账号，确认实际代理目标身份后才允许登录。
const profile = await (await fetch(`${manifest.apiBase}/users/${account.E2E_USER_ID}`)).json();
assert.equal(profile.data.username, account.E2E_USERNAME);
const response = await fetch(`${manifest.apiBase}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ account: account.E2E_USERNAME, password: account.E2E_PASSWORD }),
});
assert(response.ok);
const auth = await response.json();
assert.equal(auth.data.user.id, account.E2E_USER_ID);
const logout = await fetch(`${manifest.apiBase}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${auth.data.accessToken}` } });
assert(logout.ok);
writeFileSync(process.argv[2], JSON.stringify({ runId: manifest.runId, root: dirname(env.E2E_MANIFEST), userId: account.E2E_USER_ID }), { flag: 'wx', mode: 0o600 });
console.log('消费者私有 env、正常登录/退出及数据凭据隔离通过');
