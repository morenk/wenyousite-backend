import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

async function main() {
  const manifestPath = process.env.E2E_MANIFEST!;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const fixturePath = process.env.E2E_ADMIN_FIXTURES!;
  assert.equal(fixturePath, join(dirname(manifestPath), 'admin-fixtures.json'));
  const stat = lstatSync(fixturePath);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o600);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.runId, manifest.runId); assert.equal(fixture.runId, process.env.E2E_RUN_ID);
  assert.equal(fixture.mailboxPath, join(dirname(manifestPath), 'admin-mailbox'));
  assert.equal(manifest.apiBase, process.env.API_BASE);
  assert.equal(new URL(manifest.apiBase).hostname, '127.0.0.1');
  assert.notEqual(new URL(manifest.apiBase).port, '3000');
  const headers: Record<string, Record<string,string>> = {};
  for (const account of fixture.accounts) {
    const before = new Set(readdirSync(fixture.mailboxPath));
    const challenge = await fetch(manifest.apiBase + '/admin/auth/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: account.email, password: account.password }) });
    assert.equal(challenge.status, 200);
    const challengeId = (await challenge.json() as {data:{challengeId:string}}).data.challengeId;
    let code: string | undefined;
    for (const name of readdirSync(fixture.mailboxPath).filter(x => !before.has(x))) {
      const mail = JSON.parse(readFileSync(join(fixture.mailboxPath, name), 'utf8'));
      if (mail.to === account.email) code = String(mail.html).match(/>([0-9]{6})</)?.[1];
    }
    assert(code, '本轮本地验证码缺失');
    const verify = await fetch(manifest.apiBase + '/admin/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId, code }) });
    assert.equal(verify.status, 200);
    const csrfToken = (await verify.json() as {data:{csrfToken:string}}).data.csrfToken;
    headers[account.role] = { 'content-type':'application/json', cookie: verify.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '), 'x-csrf-token': csrfToken };
  }
  const draft = { platform:'android', versionName:'fixture.1', buildNumber:1960000000, summary:'隔离后台联验', items:['本轮随机管理员创建'] };
  const created = await fetch(manifest.apiBase+'/admin/mobile-releases',{method:'POST',headers:headers.ADMIN,body:JSON.stringify(draft)});
  assert.equal(created.status,201);
  const id=(await created.json() as {data:{id:string}}).data.id;
  const confirm=(role:string)=>fetch(manifest.apiBase+`/admin/mobile-releases/${id}/confirm`,{method:'POST',headers:headers[role],body:JSON.stringify({revision:1})});
  assert.equal((await confirm('ADMIN')).status,403);
  assert.equal((await confirm('SUPER_ADMIN')).status,201);
  assert.equal((await fetch(manifest.apiBase+'/mobile-releases/android/1960000000')).status,404);
  console.log(JSON.stringify({ event:'admin-fixtures-verified',runId:fixture.runId,credentialsPrinted:false }));
}
void main().catch(()=>{console.error('管理测试账号真实登录/CSRF联验失败（凭据已隐藏）');process.exitCode=1;});
