import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { ownedGroup, processStart, stopOwnedGroup } from '../e2e-processes';
import { Session, databaseUrl, environment, load, save } from './common';

export function runTool(s: Session, file: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return execFileSync(file,args,{ cwd:s.root, env:{...environment(s),...env},stdio:'pipe' });
}
export function launch(s: Session, name: string, file: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const fd = openSync(join(s.root,name+'.log'),'a',0o600);
  try {
    const child = spawn(file,args,{ cwd:s.root, env:{...environment(s),...env,E2E_RUN_ID:s.runId,E2E_RESOURCE_ROOT:s.root}, detached:true, stdio:['ignore',fd,fd] });
    assert(child.pid,'子进程未启动');
    const started = processStart(child.pid);
    assert(started,'子进程身份登记失败');
    s.processes.push({ name,group:child.pid,started }); save(s);
    child.on('error',()=>undefined); child.unref();
  } finally { closeSync(fd); }
}
export async function stop(s: Session) {
  for (const p of [...s.processes].reverse()) await stopOwnedGroup(p.group,s.runId,s.root,p.started);
  s.processes=[]; s.state='stopped'; save(s);
}
export function alive(s: Session, name: string) {
  const p=s.processes.find(p=>p.name===name);
  return !!p && ownedGroup(p.group,s.runId,s.root,p.started).length>0;
}
export function clients(s: Session, owner=false) {
  const db=new PrismaClient({ datasourceUrl:databaseUrl(s,owner), log:[] });
  const redis=new Redis({ host:'127.0.0.1',port:s.ports.redis,password:s.secrets.redis,lazyConnect:true,retryStrategy:()=>null,maxRetriesPerRequest:1,connectTimeout:1500 });
  redis.on('error',()=>undefined);
  return {db,redis};
}
export async function verifyResources(s: Session, db: PrismaClient, redis: Redis) {
  const current=load(s.sessionId);
  assert(current.runId===s.runId && ['initializing','ready'].includes(current.state),'会话未运行');
  const rows=await db.$queryRawUnsafe<Array<{cluster_name:string}>>('SHOW cluster_name');
  assert.equal(rows[0]?.cluster_name,s.runId,'PostgreSQL 实例身份不符');
  if (redis.status!=='ready') await redis.connect();
  const info=await redis.info('server');
  assert(s.redisInstance && info.includes('run_id:'+s.redisInstance+'\r\n'),'Redis 实例身份不符');
  assert.equal(await redis.get('preview:ownership'),s.runId,'Redis 归属不符');
  assert(alive(s,'postgres') && alive(s,'redis'),'数据进程归属不符');
}
export async function waitFor(check:()=>Promise<unknown>, message:string, attempts=120) {
  for (let i=0;i<attempts;i++) {
    try { await check(); return; } catch { if(i===attempts-1) throw new Error(message); }
    await new Promise(ok=>setTimeout(ok,250));
  }
}

/** 证明代理目标监听 socket 确由登记的 API 进程组持有，端口地址本身不是身份。 */
export function ownsListener(s:Session,name:string,port:number) {
  const p=s.processes.find(x=>x.name===name);if(!p)return false;
  const hex=port.toString(16).toUpperCase().padStart(4,'0');
  const entries=readFileSync('/proc/net/tcp','utf8').trim().split('\n').slice(1).map(x=>x.trim().split(/\s+/));
  const inodes=new Set(entries.filter(x=>x[1]==='0100007F:'+hex&&x[3]==='0A').map(x=>x[9]));
  for(const pid of ownedGroup(p.group,s.runId,s.root,p.started)){
    try { for(const fd of readdirSync('/proc/'+pid+'/fd')) {
      const match=readlinkSync('/proc/'+pid+'/fd/'+fd).match(/^socket:\[(\d+)\]$/);
      if(match&&inodes.has(match[1]))return true;
    }} catch { /* 进程退出或描述符关闭时不放行。 */ }
  }
  return false;
}
