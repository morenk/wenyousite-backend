import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unusedPort } from '../e2e-resources';
import { consumer, load, verifyConsumer } from './common';
import { cleanup, start, withLock } from './lifecycle';
import { stop, clients, verifyResources } from './resources';
import { sampleDownloadConfig } from './download-sample';
import { DownloadBudget } from '../../src/app-downloads/download-budget';
import { downloadBudgetLimits } from '../../src/app-downloads/download-config';

async function main() {
  const root=mkdtempSync(join(tmpdir(),'download-preview-test-'));
  const name='download-sample-'+randomBytes(6).toString('hex');
  process.env.PREVIEW_STATE_ROOT=root;
  try {
    const webPort=String(await unusedPort());
    let s=await withLock(name,()=>start(name,{sample:'downloads','web-port':webPort}));
    await verifyConsumer(s);
    const config=sampleDownloadConfig(s), c=consumer(s);
    const isolated=clients(s);
    try { await verifyResources(s,isolated.db,isolated.redis); assert.equal(await isolated.db.user.count(),0); }
    finally { isolated.redis.disconnect(); await isolated.db.$disconnect(); }
    const info=await fetch(c.backend.apiBase+'/app-downloads/android'); assert.equal(info.status,200);
    const release=(await info.json() as {data:{release:{buildNumber:number;downloadUrl:string;releaseNotesUrl:string;sizeBytes:number;sha256:string}}}).data.release;
    assert.equal(release.buildNumber,4242); assert.equal(new URL(release.downloadUrl).origin,c.backend.origin); assert.equal(new URL(release.releaseNotesUrl).origin,c.backend.origin);
    const head=await fetch(release.downloadUrl,{method:'HEAD'}); assert.equal(head.status,200); assert.equal(head.headers.get('x-amz-meta-apk-sha256'),release.sha256);
    const file=await fetch(release.downloadUrl); assert.equal(file.status,200);
    const bytes=Buffer.from(await file.arrayBuffer()); assert.equal(bytes.length,release.sizeBytes); assert.equal(createHash('sha256').update(bytes).digest('hex'),release.sha256);
    assert.equal((await fetch(release.releaseNotesUrl)).status,200);
    assert.equal((await fetch(c.backend.apiBase+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,409);
    assert.equal((await fetch(release.downloadUrl,{headers:{origin:'https://unexpected.invalid'}})).status,403);
    const budget=()=>new DownloadBudget(join(config.DOWNLOAD_EGRESS_DIR,'budget.sqlite'),'egress',downloadBudgetLimits(config,'egress'));
    let b=budget(); const reserved=b.status().dayReservedBytes; b.close();
    const fixture=readFileSync(join(s.root,'download-fixture.json'),'utf8'), runId=s.runId;
    await withLock(name,()=>stop(s)); assert(existsSync(join(s.root,'postgres')));
    s=await withLock(name,()=>start(name,{})); await verifyConsumer(s); assert.equal(s.runId,runId);
    assert.equal(readFileSync(join(s.root,'download-fixture.json'),'utf8'),fixture);
    b=budget(); assert.equal(b.status().dayReservedBytes,reserved); b.close();
    console.log(JSON.stringify({event:'download-preview-passed',runId,scenarios:['verified-independent-resources','anonymous-file-navigation','private-notes','head-metadata','body-sha','write-identity-required','origin-denied','stop-preserves','resume-preserves-budget']}));
  } finally {
    if(existsSync(join(root,name))) {const s=load(name);await withLock(name,async()=>{await stop(s);await cleanup(s,name);});}
    rmSync(root,{recursive:true});
    console.log(JSON.stringify({event:'download-preview-cleaned',sessionId:name,resourcesCleaned:true}));
  }
}
void main().catch((error:unknown)=>{
  const e=error as {name?:string;code?:string;stack?:string};
  writeFileSync('/tmp/download-preview-failure-'+process.pid+'.log',JSON.stringify({name:e.name,code:e.code,sites:e.stack?.split('\n').filter(x=>x.trim().startsWith('at '))}),{mode:0o600});
  console.error('DOWNLOAD_PREVIEW_INTEGRATION_FAILED');process.exitCode=1;
});
