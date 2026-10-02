import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unusedPort } from '../e2e-resources';
import { businessDate, consumer, load, REPO, save, Session, writePrivate } from './common';
import { rebindWebPort, start, withLock } from './lifecycle';
import { alive, launch, stop } from './resources';
import { main } from './cli';
import { DownloadBudget } from '../../src/app-downloads/download-budget';

async function listen(port:number) {
  const server=createServer();
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  return server;
}
async function close(server:Server) { await new Promise<void>((ok,fail)=>server.close(e=>e?fail(e):ok())); }
async function fixture(use:(s:Session,next:number)=>Promise<void>) {
  const root=mkdtempSync(join(tmpdir(),'preview-rebind-test-')), previous=process.env.PREVIEW_STATE_ROOT;
  process.env.PREVIEW_STATE_ROOT=root;
  const name='rebind-test', sessionRoot=join(root,name);
  mkdirSync(sessionRoot,{mode:0o700});
  const ports:number[]=[];
  while(ports.length<7) {const port=await unusedPort();if(!ports.includes(port))ports.push(port);}
  const secret='a'.repeat(64);
  const s:Session={version:1,sessionId:name,runId:'preview_'+'a'.repeat(24),root:sessionRoot,worktree:REPO,uid:process.getuid!(),state:'ready',initialized:true,backendSha:'b'.repeat(40),sourceDigest:'c'.repeat(64),sourceDirty:false,
    snapshot:{version:1,capturedAt:new Date().toISOString(),businessDate:businessDate(),sha256:'d'.repeat(64),sourceSha:'e'.repeat(40),migrationVersion:'test',mediaSha256:'f'.repeat(64),mediaOrigin:'https://synthetic.invalid'},
    ports:{postgres:ports[0],redis:ports[1],backend:ports[2],media:ports[3],api:ports[4],web:ports[5]},secrets:{owner:secret,app:secret,redis:secret,jwt:secret,pepper:secret},processes:[],tools:{pg:'/unavailable',redis:'/unavailable'}};
  save(s);writePrivate(join(s.root,'ownership.json'),{runId:s.runId,root:s.root,uid:s.uid,worktree:REPO});writePrivate(join(s.root,'consumer.json'),consumer(s));
  writeFileSync(join(s.root,'preserved.bin'),Buffer.from([0,1,2,255]),{mode:0o600});
  DownloadBudget.initialize(join(s.root,'budget.sqlite'),'egress');
  const budget=new DownloadBudget(join(s.root,'budget.sqlite'),'egress',{day:1000,month:2000});budget.reserve(123);budget.close();
  try {await use(s,ports[6]);}
  finally {
    await stop(s);rmSync(root,{recursive:true});
    if(previous===undefined)delete process.env.PREVIEW_STATE_ROOT;else process.env.PREVIEW_STATE_ROOT=previous;
  }
}
const args=(s:Session,port:number)=>({session:s.sessionId,confirm:s.sessionId,'web-port':String(port)});
function assertData(s:Session) {
  assert.deepEqual(readFileSync(join(s.root,'preserved.bin')),Buffer.from([0,1,2,255]));
  const budget=new DownloadBudget(join(s.root,'budget.sqlite'),'egress',{day:1000,month:2000});
  try {assert.equal(budget.status().dayReservedBytes,123);assert.equal(budget.status().monthReservedBytes,123);}finally{budget.close();}
}

test('显式重绑定按身份停止自有进程，保留 runId/配置/数据/预算并使旧描述失效',async()=>fixture(async(s,next)=>{
  launch(s,'test-child',process.execPath,['-e','setInterval(()=>{},1000)']);
  assert(alive(s,'test-child'));
  const before=load(s.sessionId);
  const rebound=await withLock(s.sessionId,()=>rebindWebPort(s.sessionId,args(s,next)));
  assert(!alive(before,'test-child'));
  assert.equal(rebound.state,'stopped');assert.equal(rebound.ports.web,next);
  assert.deepEqual({...rebound,state:before.state,ports:before.ports,processes:before.processes},before);
  assert.deepEqual(load(s.sessionId),rebound);
  assert.equal(JSON.parse(readFileSync(join(s.root,'consumer.json'),'utf8')).state,'stopped');
  assertData(s);
}));

test('旧 Web 消费者或新端口被占用时拒绝，不改登记、不终止占用者',async()=>fixture(async(s,next)=>{
  const original=readFileSync(join(s.root,'session.json'));
  for(const port of [s.ports.web,next]) {
    const blocker=await listen(port);
    try {
      await assert.rejects(()=>withLock(s.sessionId,()=>rebindWebPort(s.sessionId,args(s,next))));
      assert(blocker.listening);assert.deepEqual(readFileSync(join(s.root,'session.json')),original);
      assert.equal(JSON.parse(readFileSync(join(s.root,'consumer.json'),'utf8')).state,'ready');
    } finally {await close(blocker);}
  }
  assertData(s);
}));

test('重绑定拒绝错误确认、保留/重复端口、快照变更与归属漂移',async()=>fixture(async(s,next)=>{
  const original=readFileSync(join(s.root,'session.json'));
  for(const value of [{...args(s,next),confirm:'wrong'},args(s,3000),args(s,s.ports.backend),args(s,s.ports.web),{...args(s,next),snapshot:'/other'}, {...args(s,next),'web-port':'invalid'}]) {
    await assert.rejects(()=>withLock(s.sessionId,()=>rebindWebPort(s.sessionId,value)));
    assert.deepEqual(readFileSync(join(s.root,'session.json')),original);
  }
  save({...s,worktree:'/another-task'});
  await assert.rejects(()=>withLock(s.sessionId,()=>rebindWebPort(s.sessionId,args(s,next))),/归属不符/);
  save(s);assertData(s);
}));

test('ready 状态的普通 start/resume 也拒绝隐式变更 Web 端口',async()=>fixture(async(s,next)=>{
  await assert.rejects(()=>withLock(s.sessionId,()=>start(s.sessionId,{'web-port':String(next)})),/端口不可隐式变更/);
  assert.equal(load(s.sessionId).ports.web,s.ports.web);assertData(s);
}));

test('CLI 恢复失败保留已登记新端口和数据，不发布 ready 描述',async()=>fixture(async(s,next)=>{
  const blocker=await listen(s.ports.backend);
  try {
    await assert.rejects(()=>main(['rebind-web-port','--session',s.sessionId,'--web-port',String(next),'--confirm',s.sessionId]));
    const failed=load(s.sessionId);
    assert.equal(failed.state,'failed');assert.equal(failed.ports.web,next);assert.equal(failed.runId,s.runId);
    assert.equal(JSON.parse(readFileSync(join(s.root,'consumer.json'),'utf8')).state,'stopped');
    assert(blocker.listening);assertData(s);
  } finally {await close(blocker);}
}));
