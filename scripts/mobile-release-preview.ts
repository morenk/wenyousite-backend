/** 本目标的合成数据联调入口；只启动已核验独立资源，不读取真实快照或线上凭据。 */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { withResources, unusedPort } from './e2e-resources';
import { businessDate, consumer, load, REPO, sha, stateRoot, verifyConsumer, writePrivate } from './dev-preview/common';
import { captureSnapshot } from './dev-preview/snapshot';
import { start, withLock } from './dev-preview/lifecycle';
import { MobileReleasePublication } from '../src/mobile-releases/mobile-release-publication';

async function main() {
  const name = 'mobile-release-notes';
  if (existsSync(join(stateRoot(), name))) {
    const existing = load(name); await verifyConsumer(existing);
    console.log(JSON.stringify({ event:'sample-preview-ready', sessionId:name, runId:existing.runId, consumerPath:join(existing.root,'consumer.json'), accountPath:join(existing.root,'sample-accounts.json'), isolatedSample:true })); return;
  }
  const snapshots = mkdtempSync(join(tmpdir(), 'mobile-release-sample-snapshots-'));
  const accounts: Array<{role:string;account:string;password:string}> = [];
  let started = false;
  try {
    await withResources(async r => {
      await r.verify();
      execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',join(REPO,'prisma/schema.prisma')],{cwd:r.root,env:{...r.env,DATABASE_URL:r.databaseUrl,DIRECT_DATABASE_URL:r.databaseUrl},stdio:'pipe'});
      const db = new PrismaClient({datasourceUrl:r.databaseUrl,log:[]});
      try {
        for (const role of ['USER','ADMIN','SUPER_ADMIN'] as const) {
          const username = 'sample_'+randomBytes(6).toString('hex'); const account=username+'@preview.invalid'; const password='Sample!'+randomBytes(18).toString('hex');
          await db.user.create({data:{username,email:account,password:await argon2.hash(password),role}});
          accounts.push({role,account,password});
        }
        for (const [buildNumber,status] of [[100,'published'],[101,'ready'],[102,'draft']] as const) {
          const confirmed = status !== 'draft';
          const release = await db.mobileRelease.create({data:{platform:'android',versionName:'0.0.0-preview.'+buildNumber,buildNumber,summary:'隔离样本版本说明',items:['改善版本说明阅读体验','支持从设置查看历史更新'],confirmedRevision:confirmed?1:null,confirmedSummary:confirmed?'隔离样本版本说明':null,confirmedItems:confirmed?['改善版本说明阅读体验','支持从设置查看历史更新']:[],confirmedAt:confirmed?new Date():null,publishedItems:[]}});
          if(status==='published') {
            const store=new MobileReleasePublication(db);const operationId=randomUUID();
            await store.begin({platform:'android',versionName:release.versionName,buildNumber,confirmedRevision:1,operationId,apkSha256:'a'.repeat(64),apkSize:'1',updateUrl:`https://wenyou-apk.cn-nb1.rains3.com/mobile/android/wenyou-${release.versionName}-${buildNumber}.apk`});
            await store.transition(operationId,'publish');await store.transition(operationId,'commit');await store.transition(operationId,'finish');
          }
        }
        await captureSnapshot({output:snapshots,sourceUrl:r.databaseUrl,sourceSha:sha(),mediaOrigin:'https://media.example.com',pgBin:process.env.E2E_PG_BIN!});
      } finally { await db.$disconnect(); }
    });
    const port=await unusedPort();
    const s=await withLock(name,()=>start(name,{snapshot:join(snapshots,businessDate()),'web-port':String(port)}));
    started=true;await verifyConsumer(s);
    writePrivate(join(s.root,'sample-accounts.json'),{version:1,runId:s.runId,isolatedSample:true,mailboxPath:join(s.root,'mailbox'),accounts});
    writePrivate(join(s.root,'sample-snapshot-ownership.json'),{snapshotRoot:snapshots,sessionId:name,worktree:REPO});
    console.log(JSON.stringify({event:'sample-preview-ready',sessionId:name,runId:s.runId,consumerPath:join(s.root,'consumer.json'),accountPath:join(s.root,'sample-accounts.json'),backend:consumer(s).backend.origin,webPort:port,isolatedSample:true}));
  } finally { if(!started && !existsSync(join(stateRoot(),name)))rmSync(snapshots,{recursive:true,force:true}); }
}
void main().catch(()=>{console.error('合成数据预览未就绪；检查本任务私有预览日志，禁止回落线上');process.exitCode=1;});
