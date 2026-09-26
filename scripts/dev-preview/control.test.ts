import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync,unlinkSync,utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processStart } from '../e2e-processes';
import { load, REPO, sameBoot, save, Session, writePrivate } from './common';
import { main } from './cli';
import { bootId, listSessions, withControlLock } from './control';
import { start, withLock } from './lifecycle';
import { stop } from './resources';

test('旧归属暂停必须核验 runId，显式 adopt/rebind 保留数据，失活不误报 ready',async()=>{
 const root=mkdtempSync(join(tmpdir(),'preview-control-unit-'));const previous=process.env.PREVIEW_STATE_ROOT;process.env.PREVIEW_STATE_ROOT=root;
 const name='legacy-unit';const dir=join(root,name);mkdirSync(dir,{mode:0o700});
 const runId='preview_'+'c'.repeat(24);
 const s={version:1,sessionId:name,runId,root:dir,worktree:'/srv/legacy-owner',uid:process.getuid!(),state:'ready',initialized:true,backendSha:'a'.repeat(40),sourceDigest:'b'.repeat(64),sourceDirty:false,snapshot:{version:1,capturedAt:new Date().toISOString(),businessDate:"2026-09-26",sha256:"c".repeat(64),sourceSha:"d".repeat(40),migrationVersion:"unit",mediaSha256:"e".repeat(64),mediaOrigin:"https://media.example.com"},ports:{postgres:4301,redis:4302,backend:4401,media:4402,web:4403,api:4303},secrets:{owner:'a'.repeat(64),app:'b'.repeat(64),redis:'c'.repeat(64),jwt:'d'.repeat(64),pepper:'e'.repeat(64)},processes:[],tools:{pg:"/unit",redis:"/unit"},bootId:bootId()} as Session;
 save(s);writePrivate(join(dir,'ownership.json'),{runId,root:dir,uid:s.uid,worktree:s.worktree});writePrivate(join(dir,'data-marker.json'),{preserved:true});
 const output=console.log;console.log=()=>{};
 try{
   assert.equal(sameBoot({...s,bootId:'previous-boot'}),false);
   const legacy={...s};delete legacy.bootId;utimesSync(join(dir,'session.json'),1,1);assert.equal(sameBoot(legacy),false);save(s);
   let row=(await listSessions()).sessions.find(x=>x.sessionId===name)!;
   assert.equal(row.state,'unavailable');assert.equal(row.processesAlive,false);
   await assert.rejects(()=>main(['pause','--session',name,'--owner-worktree',s.worktree,'--confirm','preview_'+'d'.repeat(24)]));
   await main(['pause','--session',name,'--owner-worktree',s.worktree,'--confirm',runId]);
   mkdirSync(join(dir,'uploads'),{mode:0o700});writeFileSync(join(dir,'uploads','existing._S3rver_object'),'retained');
   await assert.rejects(()=>main(['adopt','--session',name,'--owner-worktree',s.worktree,'--confirm',runId]));
   assert.equal(JSON.parse(readFileSync(join(dir,'session.json'),'utf8')).worktree,s.worktree);
   unlinkSync(join(dir,'uploads','existing._S3rver_object')); // 仅移除本测试创建的假文件。
   await main(['adopt','--session',name,'--owner-worktree',s.worktree,'--confirm',runId]);
   await assert.rejects(()=>main(['rebind','--session',name,'--confirm',name]));
   await main(['rebind','--session',name,'--confirm',runId]);
   const adopted=load(name);assert.equal(adopted.worktree,REPO);assert.equal(adopted.runId,runId);assert.equal(adopted.ports.media,14312);assert.equal(readFileSync(join(dir,'data-marker.json'),'utf8').includes('true'),true);
   row=(await listSessions()).sessions.find(x=>x.sessionId===name)!;assert.equal(row.state,'paused');
   const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,cwd:dir,stdio:'ignore',env:{E2E_RUN_ID:runId,E2E_RESOURCE_ROOT:dir}});
   assert(child.pid);adopted.processes=[{name:'fixture',group:child.pid,started:processStart(child.pid)!}];adopted.state='ready';save(adopted);
   try{await assert.rejects(()=>withLock('different-batch',()=>start('different-batch',{})));}finally{await stop(adopted);}
 }finally{console.log=output;if(previous===undefined)delete process.env.PREVIEW_STATE_ROOT;else process.env.PREVIEW_STATE_ROOT=previous;rmSync(root,{recursive:true});}
});

test('控制进程被强杀后 flock 释放，不残留永久操作锁',async()=>{
 const code="require('./scripts/dev-preview/control.ts').withControlLock(()=>new Promise(()=>{console.log('held');setInterval(()=>{},1000)}))";
 const child=spawn(process.execPath,['--import','tsx','-e',code],{cwd:REPO,stdio:['ignore','pipe','ignore']});
 let text='';child.stdout.on('data',data=>text+=data);
 try{
   for(let i=0;i<100&&!text.includes('held');i++)await new Promise(ok=>setTimeout(ok,30));
   assert(text.includes('held'));await assert.rejects(()=>withControlLock(async()=>{}));
   const closed=new Promise(ok=>child.once('close',ok));child.kill('SIGKILL');await closed;
   let recovered=false;
   for(let i=0;i<40&&!recovered;i++)try{await withControlLock(async()=>{});recovered=true;}catch{await new Promise(ok=>setTimeout(ok,30));}
   assert(recovered);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});
