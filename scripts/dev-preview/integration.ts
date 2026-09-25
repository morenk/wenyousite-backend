import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import sharp from 'sharp';
import { withResources } from '../e2e-resources';
import { businessDate, consumer, databaseUrl, HEADER, load, REPO, sha, stateRoot, verifyConsumer, writePrivate } from './common';
import { captureSnapshot } from './snapshot';
import { importDailyBackup } from './backup';
import { cleanup, reset, start, withLock } from './lifecycle';
import { alive, clients, stop, waitFor } from './resources';

async function run() {
  const keep=process.argv.includes('--keep');
  const name=keep?'live-preview-acceptance':'preview-integration-'+randomBytes(4).toString('hex');
  const snapshots=mkdtempSync(join(tmpdir(),'preview-snapshots-'));chmodSync(snapshots,0o700);
  const account='preview_'+randomBytes(4).toString('hex');const password='Preview!'+randomBytes(12).toString('hex');
  let sampleUserId='';
  try {
    await withResources(async r=>{
      await r.verify();
      execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',join(REPO,'prisma/schema.prisma')],{cwd:r.root,env:{...r.env,DATABASE_URL:r.databaseUrl,DIRECT_DATABASE_URL:r.databaseUrl},stdio:'pipe'});
      const db=new PrismaClient({datasourceUrl:r.databaseUrl,log:[]});
      try {
        const user=await db.user.create({data:{username:account,email:account+'@preview.invalid',password:await argon2.hash(password)}});
        sampleUserId=user.id;
        await db.emailVerification.create({data:{userId:user.id,email:user.email,token:'source-only-verification',expiresAt:new Date(Date.now()+3600000)}});
        await db.refreshToken.create({data:{userId:user.id,tokenHash:'source-only-refresh',family:'source-family',expiresAt:new Date(Date.now()+3600000)}});
        await db.domainOutbox.create({data:{eventType:'source.unsent',aggregateType:'source',eventKey:'source-outbox',payload:{test:true}}});
        const category=await db.threadCategoryDefinition.findFirstOrThrow({where:{isActive:true}});
        const thread=await db.thread.create({data:{ownerId:user.id,title:'隔离快照验收主题',category:category.slug,published:true,publishedAt:new Date(),members:{create:{userId:user.id,role:'OWNER'}}}});
        const sub=await db.subthread.create({data:{threadId:thread.id,title:'默认子贴'}});
        await db.post.create({data:{authorId:user.id,threadId:thread.id,subthreadId:sub.id,kind:'BODY',content:'仅存在于本轮独立样本数据库的正文。'}});
        await db.thread.update({where:{id:thread.id},data:{defaultSubthreadId:sub.id}});
        await captureSnapshot({output:snapshots,sourceUrl:r.databaseUrl,sourceSha:sha(),mediaOrigin:'https://media.example.com',pgBin:process.env.E2E_PG_BIN!});
        const again=await captureSnapshot({output:snapshots,sourceUrl:r.databaseUrl,sourceSha:sha(),mediaOrigin:'https://media.example.com',pgBin:process.env.E2E_PG_BIN!});
        assert.equal(again.businessDate,businessDate());
        const backupRoot=join(snapshots,'logical');mkdirSync(backupRoot,{mode:0o700});
        const stamp=again.capturedAt.slice(0,19).replace(/[-:]/g,'')+'Z';
        const filename='wenyousite_postgres_'+stamp+'.dump';
        copyFileSync(join(snapshots,businessDate(),'database.dump'),join(backupRoot,filename));chmodSync(join(backupRoot,filename),0o600);
        writeFileSync(join(backupRoot,filename+'.sha256'),again.sha256+'  '+filename+'\n',{mode:0o600});
        const imported=importDailyBackup({backupRoot,output:join(snapshots,'imported'),sourceSha:sha(),mediaOrigin:'https://media.example.com',pgBin:process.env.E2E_PG_BIN!});
        assert.equal(imported?.sha256,again.sha256);assert.equal(imported?.migrationVersion,again.migrationVersion);
        assert.equal(await db.emailVerification.count(),1);
        assert.equal(await db.refreshToken.count(),1);
      }finally{await db.$disconnect();}
    });
    console.log(JSON.stringify({event:'source-snapshot-isolated-and-cleaned'}));
    let s=await withLock(name,()=>start(name,{snapshot:join(snapshots,businessDate()),'web-port':keep?'43881':'43882'}));
    const c=consumer(s);await verifyConsumer(s);
    const isolated=clients(s);
    try {
      assert.equal(await isolated.db.emailVerification.count(),0);assert.equal(await isolated.db.refreshToken.count(),0);
      assert.equal(await isolated.db.domainOutbox.count({where:{eventKey:'source-outbox'}}),0);
      assert(await argon2.verify((await isolated.db.user.findUniqueOrThrow({where:{id:sampleUserId}})).password,password));
      const noIdentity=await fetch(c.backend.apiBase+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account,password})});
      assert.equal(noIdentity.status,409);
      const login=await fetch(c.backend.apiBase+'/auth/login',{method:'POST',headers:{'content-type':'application/json',[HEADER]:s.runId,'x-client-platform':'mobile'},body:JSON.stringify({account,password})});
      assert.equal(login.status,200);
      const auth=(await login.json() as {data:{accessToken:string}}).data;
      assert(auth.accessToken);
      const call=async(path:string,body?:unknown)=>{
        const response=await fetch(c.backend.apiBase+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',[HEADER]:s.runId,authorization:'Bearer '+auth.accessToken},body:body?JSON.stringify(body):undefined});
        assert(response.ok,'API 返回 '+response.status+' '+path);
        return (await response.json() as {data:any}).data;
      };
      const png=await sharp({create:{width:128,height:128,channels:3,background:'#dd8844'}}).png().toBuffer();
      const upload=await call('/media/upload-url',{filename:'preview.png',contentType:'image/png',size:png.length,purpose:'AVATAR'});
      assert.equal(new URL(upload.uploadUrl).origin,c.media.origin);
      const wrongSignature=new URL(upload.uploadUrl);wrongSignature.searchParams.set('X-Amz-Signature','0'.repeat(64));
      assert.equal((await fetch(wrongSignature,{method:'PUT',headers:{'content-type':'image/png'},body:png})).status,403);
      const put=await fetch(upload.uploadUrl,{method:'PUT',headers:{'content-type':'image/png'},body:png});
      assert(put.ok,'预签名上传失败 '+put.status);
      await call('/media/upload-done',{mediaId:upload.mediaId});
      let processed:any;
      await waitFor(async()=>{processed=await call('/media/'+upload.mediaId);assert.equal(processed.status,'COMPLETED');},'图片 Worker 未完成',120);
      const image=await fetch(processed.url);assert(image.ok);
      assert((await image.arrayBuffer()).byteLength>0);
      const localStorage=new S3Client({endpoint:c.media.origin,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:'S3RVER',secretAccessKey:'S3RVER'}});
      const objectKey=decodeURIComponent(new URL(processed.url).pathname.slice('/preview/'.length));
      await localStorage.send(new DeleteObjectCommand({Bucket:'preview',Key:objectKey}));
      assert.equal((await fetch(processed.url)).status,404);localStorage.destroy();
      const {EmailService}=await import('../../src/email/email.service');
      const {ConfigService}=await import('@nestjs/config');
      const mail=new EmailService(new ConfigService({app:{nodeEnv:'test'},ses:{previewMailbox:join(s.root,'mailbox'),from:'preview@preview.invalid'}}));
      await mail.sendVerification('nobody@preview.invalid','123456');
      assert.equal(readdirSync(join(s.root,'mailbox')).length,1);
      writePrivate(join(s.root,'sample-account.json'),{account,password,userId:sampleUserId,isolatedSample:true});
      console.log(JSON.stringify({event:'passed',scenarios:['snapshot-reuse','existing-logical-backup-import','source-unchanged','credential-preserved','sessions-sanitized','missing-identity-denied','login','bad-signature-denied','presigned-put','local-delete','image-worker','public-image','private-mailbox'],runId:s.runId}));
    }finally{isolated.redis.disconnect();await isolated.db.$disconnect();}
    const guardClients=clients(s);await guardClients.redis.connect();
    await guardClients.redis.set('preview:ownership','wrong-resource');
    assert.equal((await fetch(c.backend.identityUrl)).status,503);
    await guardClients.redis.set('preview:ownership',s.runId);guardClients.redis.disconnect();await guardClients.db.$disconnect();
    await verifyConsumer(s);
    const runId=s.runId;
    const api=s.processes.find(p=>p.name==='api')!;process.kill(api.group,'SIGKILL');
    await waitFor(async()=>assert(!alive(s,'api')),'API强杀未退出');
    await assert.rejects(()=>verifyConsumer(s));
    await withLock(name,()=>stop(s));
    assert(existsSync(join(s.root,'postgres')));
    const blocker=createServer((_req,res)=>res.end('foreign process'));
    await new Promise<void>(ok=>blocker.listen(s.ports.backend,'127.0.0.1',ok));
    await assert.rejects(()=>withLock(name,()=>start(name,{})));
    assert.equal(await (await fetch(c.backend.origin)).text(),'foreign process');
    await new Promise<void>((ok,fail)=>blocker.close(e=>e?fail(e):ok()));
    s=await withLock(name,()=>start(name,{}));assert.equal(s.runId,runId);await verifyConsumer(s);
    if(keep){console.log(JSON.stringify({event:'acceptance-ready',consumerPath:join(s.root,'consumer.json'),sessionId:name,sourceSha:s.backendSha,isolatedSample:true,snapshotPath:join(snapshots,businessDate())}));return;}
    s=await withLock(name,()=>reset(name,{confirm:name,snapshot:join(snapshots,businessDate())}));assert.notEqual(s.runId,runId);
    await withLock(name,async()=>{await stop(s);await cleanup(s,name);});
    assert(!existsSync(s.root));
    console.log(JSON.stringify({event:'passed',scenarios:['killed-api-fails-identity','resource-mismatch-denied','port-conflict-preserves-foreign-process','stop-preserves','resume-keeps-run','reset-new-run','cleanup-owned'],resourcesCleaned:true}));
  }finally{
    if(!keep&&existsSync(join(stateRoot(),name))) {
      const s=load(name);await stop(s);await cleanup(s,name);
    }
    if(!keep)rmSync(snapshots,{recursive:true});
  }
}
void run().catch((error)=>{writeFileSync('/tmp/preview-integration-failure-'+process.pid+'.log',String(error?.stack||error),{mode:0o600});console.error('预览隔离集成验收失败；请核对本批次私有日志');process.exitCode=1;});
