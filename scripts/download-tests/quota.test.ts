import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DownloadBudget, DownloadInstanceLock, beijingPeriods } from '../../src/app-downloads/download-budget';
import { DownloadDevice, DEVICE_COOKIE_SECONDS, freshDeviceKeys } from '../../src/app-downloads/download-device';
import { DownloadFailure } from '../../src/app-downloads/download-model';
import { isolatedFiles } from './fixture';

const device = () => randomBytes(32).toString('base64url');
const limits = { day: 10000, month: 20000 };
function state(path:string) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {return {bytes:db.prepare('SELECT * FROM counters ORDER BY period').all(),clock:db.prepare('SELECT * FROM clock').all(),counts:db.prepare('SELECT * FROM download_counts ORDER BY day,kind,subject').all(),days:db.prepare('SELECT * FROM download_count_days ORDER BY day').all()};}
  finally {db.close();}
}
function rejects(reason:string) {return (e:unknown)=>e instanceof DownloadFailure && e.reason===reason;}

test('签名随机 Cookie 稳定、防篡改且始终要求 Secure；非法/缺失 Cookie 不冒充已有设备',()=>{
  const keys=freshDeviceKeys(), service=new DownloadDevice(keys), now=Date.now();
  const first=service.resolve(undefined,now), cookie=first.setCookie!.split(';')[0];
  assert(!first.recognized);assert(first.setCookie!.includes('; HttpOnly; SameSite=Lax;'));
  assert(first.setCookie!.endsWith('; Secure'));assert(first.setCookie!.startsWith('__Host-'));assert(!first.setCookie!.includes('Domain='));
  const recognized=service.resolve(cookie,now+1000);assert(recognized.recognized);assert(recognized.device===first.device);assert.equal(recognized.setCookie,undefined);
  for(const invalid of ['',cookie+'; '+cookie,cookie.replace(first.device,device()),cookie.slice(0,-1)+(cookie.endsWith('A')?'B':'A'),'device='+first.device]) {
    const result=service.resolve(invalid,now);assert(!result.recognized);assert(result.device!==first.device);
  }
  assert(!service.resolve(cookie,now+DEVICE_COOKIE_SECONDS*1000).recognized);
});

test('次数与字节同一事务：设备、IP、日/月字节、记录容量拒绝均不误扣其他额度',async()=>{
  for(const denied of ['device','ip','day','month','capacity'] as const) {
    const {root,config}=await isolatedFiles(), path=join(config.DOWNLOAD_EGRESS_DIR,'budget.sqlite');
    const quota={device:denied==='device'?1:3,ip:denied==='ip'?1:10,subjects:denied==='capacity'?2:100};
    const budget=new DownloadBudget(path,'egress',{day:denied==='day'?15:10000,month:denied==='month'?15:20000},quota);
    try {
      const actor={device:device(),ip:'192.0.2.1'}, now=Date.now();budget.reserveFile(10,actor,now);
      const before=state(path), next=denied==='device'?{...actor,ip:'192.0.2.2'}:denied==='ip'||denied==='capacity'?{...actor,device:device()}:actor;
      assert.throws(()=>budget.preflightFile(10,next,now+1),rejects(denied==='device'?'device_daily_limit':denied==='ip'?'ip_daily_limit':denied==='capacity'?'unavailable':'budget'));
      assert.deepEqual(state(path),before);
      assert.throws(()=>budget.reserveFile(10,next,now+1));assert.deepEqual(state(path),before);
    } finally {budget.close();await rm(root,{recursive:true,force:true});}
  }
});

test('HEAD 预检不写入；HEAD→GET 竞争由最终事务拒绝，跨日清理不清零当前次数',async()=>{
  const {root,config}=await isolatedFiles(),path=join(config.DOWNLOAD_EGRESS_DIR,'budget.sqlite');
  const budget=new DownloadBudget(path,'egress',limits,{device:1,ip:10,subjects:2}), actor={device:device(),ip:'192.0.2.1'};
  const now=Date.parse('2026-10-31T15:59:59.000Z');
  try {
    const before=state(path);budget.preflightFile(10,actor,now);budget.preflightFile(10,actor,now);assert.deepEqual(state(path),before);
    budget.reserveFile(10,actor,now);assert.throws(()=>budget.reserveFile(10,actor,now),rejects('device_daily_limit'));
    budget.reserveFile(10,{device:device(),ip:'192.0.2.2'},now+1000);
    const after=state(path);assert.equal(after.counts.length,2);assert(after.counts.every(row=>row.day==='2026-11-01'));
    assert.equal(after.days.length,1);assert.equal(budget.status(now+1000).monthReservedBytes,10);
    assert.throws(()=>budget.preflightFile(1,actor,now));assert.throws(()=>budget.reserveFile(1,actor,now));assert.deepEqual(state(path),after);
    assert.equal(beijingPeriods(now).dayRetry,1);
  } finally {budget.close();await rm(root,{recursive:true,force:true});}
});

test('无 Cookie/不同设备共用 IP 上限，有效同设备跨 IP 仍共享独立次数',async()=>{
  const {root,config}=await isolatedFiles(),path=join(config.DOWNLOAD_EGRESS_DIR,'budget.sqlite');
  const budget=new DownloadBudget(path,'egress',limits), a=device(), now=Date.now();
  try {
    for(let i=0;i<3;i++)budget.reserveFile(1,{device:a,ip:'192.0.2.'+(i+1)},now);
    assert.throws(()=>budget.reserveFile(1,{device:a,ip:'192.0.2.99'},now),rejects('device_daily_limit'));
    for(let i=0;i<10;i++)budget.reserveFile(1,{device:device(),ip:'198.51.100.1'},now);
    assert.throws(()=>budget.reserveFile(1,{device:device(),ip:'198.51.100.1'},now),rejects('ip_daily_limit'));
    const stored=JSON.stringify(state(path));assert(!stored.includes(a));assert(!stored.includes('198.51.100.1'));
  } finally {budget.close();await rm(root,{recursive:true,force:true});}
});

test('签名密钥轮换保留随机标识/计数，旧签名宽限有界，重复轮换不静默失效 Cookie',async()=>{
  const {root,config}=await isolatedFiles(),path=join(config.DOWNLOAD_EGRESS_DIR,'budget.sqlite');
  let budget=new DownloadBudget(path,'egress',limits);const now=Date.now();
  try {
    const original=new DownloadDevice(budget.deviceKeys()), identity=original.resolve(undefined,now), cookie=identity.setCookie!.split(';')[0];
    for(let i=0;i<3;i++)budget.reserveFile(1,{ip:'192.0.2.1',device:identity.device},now);
    const before=state(path);budget.rotateDeviceKey(now);assert.deepEqual(state(path),before);
    assert.throws(()=>budget.rotateDeviceKey(now+1));
    budget.close();budget=new DownloadBudget(path,'egress',limits);
    const updated=new DownloadDevice(budget.deviceKeys()), renewed=updated.resolve(cookie,now+1000);
    assert(renewed.recognized && renewed.device===identity.device && renewed.setCookie);
    assert.throws(()=>budget.reserveFile(1,{ip:'192.0.2.2',device:renewed.device},now+1000),rejects('device_daily_limit'));
    const later=now+(DEVICE_COOKIE_SECONDS+1)*1000;
    budget.rotateDeviceKey(later);assert(!new DownloadDevice(budget.deviceKeys()).resolve(cookie,later).recognized);
  } finally {budget.close();await rm(root,{recursive:true,force:true});}
});

test('v1 离线升级保留字节、时钟、inode；重复升级不换密钥，升级后多进程/重启不可超领',async()=>{
  const {root,config}=await isolatedFiles(),directory=join(root,'legacy');await mkdir(directory,{mode:0o700});
  const path=join(directory,'budget.sqlite'),envPath=join(root,'legacy.env');
  await writeFile(path,'',{mode:0o600});const db=new DatabaseSync(path);
  db.exec("CREATE TABLE identity(version INTEGER,kind TEXT);INSERT INTO identity VALUES(1,'egress');CREATE TABLE counters(period TEXT PRIMARY KEY,bytes INTEGER);CREATE TABLE clock(last_ms INTEGER);INSERT INTO clock VALUES(0);");db.close();
  DownloadInstanceLock.initialize(join(directory,'gateway-lock.sqlite'));
  const now=Date.now(),beforeStat=await stat(path),legacy=new DownloadBudget(path,'egress',limits);legacy.reserve(123,now);assert.throws(()=>legacy.deviceKeys());legacy.close();
  await writeFile(envPath,Object.entries({...config,DOWNLOAD_EGRESS_DIR:directory}).map(([k,v])=>`${k}=${v}`).join('\n'),{mode:0o600});
  const cli=(command:string)=>execFileSync(process.execPath,['--require',require.resolve('ts-node/register/transpile-only'),require.resolve('../../src/app-downloads/download-cli'),command,'--env',envPath],{stdio:'pipe'});
  try {
    const held=new DownloadInstanceLock(join(directory,'gateway-lock.sqlite'));
    try {assert.throws(()=>cli('upgrade-egress-ledger'));}finally{held.close();}
    cli('upgrade-egress-ledger');
    let budget=new DownloadBudget(path,'egress',limits);assert.equal(budget.status(now).dayReservedBytes,123);
    const cookie=new DownloadDevice(budget.deviceKeys()).resolve(undefined,now).setCookie!.split(';')[0];budget.close();
    assert.equal((await stat(path)).ino,beforeStat.ino);assert.equal(state(path).clock[0].last_ms,now);
    cli('upgrade-egress-ledger');budget=new DownloadBudget(path,'egress',limits);
    const actor={ip:'192.0.2.1',device:new DownloadDevice(budget.deviceKeys()).resolve(cookie,now).device};budget.close();
    const script=`const {DownloadBudget}=require(${JSON.stringify(require.resolve('../../src/app-downloads/download-budget'))});const b=new DownloadBudget(process.argv[1],'egress',{day:10000,month:20000});let n=0;for(let i=0;i<3;i++){try{b.reserveFile(10,JSON.parse(process.argv[2]),Number(process.argv[3]));n++;}catch{}}b.close();process.stdout.write(String(n));`;
    const jobs=Array.from({length:4},()=>new Promise<number>((resolve,reject)=>{
      const child=spawn(process.execPath,['--require',require.resolve('ts-node/register/transpile-only'),'-e',script,path,JSON.stringify(actor),String(now+1000)],{stdio:['ignore','pipe','pipe']});
      let out='';child.stdout.on('data',chunk=>{out+=String(chunk);});child.stderr.resume();child.on('error',reject);child.on('exit',code=>code===0?resolve(Number(out)):reject(new Error('quota child failed')));
    }));
    assert.equal((await Promise.all(jobs)).reduce((a,b)=>a+b,0),3);
    const ipScript=`const {DownloadBudget}=require(${JSON.stringify(require.resolve('../../src/app-downloads/download-budget'))});const {randomBytes}=require('node:crypto');const b=new DownloadBudget(process.argv[1],'egress',{day:10000,month:20000});let n=0;for(let i=0;i<4;i++){try{b.reserveFile(10,{ip:'198.51.100.1',device:randomBytes(32).toString('base64url')},Number(process.argv[2]));n++;}catch{}}b.close();process.stdout.write(String(n));`;
    const ipJobs=Array.from({length:4},()=>new Promise<number>((resolve,reject)=>{
      const child=spawn(process.execPath,['--require',require.resolve('ts-node/register/transpile-only'),'-e',ipScript,path,String(now+1000)],{stdio:['ignore','pipe','pipe']});
      let out='';child.stdout.on('data',chunk=>{out+=String(chunk);});child.stderr.resume();child.on('error',reject);child.on('exit',code=>code===0?resolve(Number(out)):reject(new Error('IP quota child failed')));
    }));
    assert.equal((await Promise.all(ipJobs)).reduce((a,b)=>a+b,0),10);
    budget=new DownloadBudget(path,'egress',limits);
    try {assert.equal(budget.status(now+1000).dayReservedBytes,253);assert.throws(()=>budget.reserveFile(1,actor,now+1000),rejects('device_daily_limit'));assert.throws(()=>budget.reserveFile(1,{ip:'198.51.100.1',device:device()},now+1000),rejects('ip_daily_limit'));}finally{budget.close();}
  } finally {await rm(root,{recursive:true,force:true});}
});

test('缺失签名状态拒绝，不通过自动重建重置次数',async()=>{
  const {root,config}=await isolatedFiles(),path=join(config.DOWNLOAD_EGRESS_DIR,'budget.sqlite');
  try {
    const budget=new DownloadBudget(path,'egress',limits);budget.reserveFile(1,{ip:'192.0.2.1',device:device()});budget.close();
    const before=state(path),db=new DatabaseSync(path);db.exec('DELETE FROM download_device_keys');db.close();
    assert.throws(()=>new DownloadBudget(path,'egress',limits));assert.throws(()=>DownloadBudget.upgradeEgress(path));assert.deepEqual(state(path),before);
  } finally {await rm(root,{recursive:true,force:true});}
});
