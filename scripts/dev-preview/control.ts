import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { loadAt, privateDirectory, privateFile, Session, sameBoot, stateRoot, verifyConsumer, writePrivate } from './common';
import { alive } from './resources';
const {controlRoot} = require('../dev-heavy.mjs') as {controlRoot:()=>string};
export const FIXED_PORTS={web:4310,backend:4311,media:4312};
export const bootId=()=>readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
export async function withControlLock<T>(use:()=>Promise<T>):Promise<T> {
  const lock=spawn('/usr/bin/flock',['--nonblock','--conflict-exit-code','75',join(controlRoot(),'preview.lock'),process.execPath,'-e',"process.stdout.write('locked');process.stdin.resume()"],{stdio:['pipe','pipe','ignore']});
  const closed=new Promise<void>(ok=>lock.once('close',()=>ok()));
  await new Promise<void>((ok,fail)=>{lock.once('error',fail);lock.stdout.once('data',()=>ok());lock.once('close',()=>fail(new Error('PREVIEW_CONTROL_BUSY')));});
  try{return await use();}finally{lock.stdin.end();await closed;}
}
function roots() {
  const registry=join(controlRoot(),'preview-roots.json');
  const all=new Set<string>([join(userInfo().homedir,'.local/state/wenyousite-preview'),stateRoot()]);
  if(existsSync(registry))for(const root of JSON.parse(readFileSync(privateFile(registry),'utf8')))all.add(root);
  // 导入旧工具在自定义根启动的存活进程，不读取或输出其余环境配置。
  for(const pid of readdirSync('/proc'))if(/^\d+$/.test(pid))try{
    const env=readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
    const id=env.find(x=>x.startsWith('E2E_RUN_ID=preview_'));
    const root=env.find(x=>x.startsWith('E2E_RESOURCE_ROOT='))?.slice('E2E_RESOURCE_ROOT='.length);
    if(id&&root&&existsSync(join(root,'session.json')))all.add(dirname(root));
  }catch{/* 其他 UID 或已退出进程不可读。 */}
  return [...all];
}
export function registerRoot(){const all=roots();for(const root of all)if(existsSync(root))privateDirectory(root);writePrivate(join(controlRoot(),'preview-roots.json'),all);}
export function processesAlive(s:Session) {
  if(!sameBoot(s))return false;
  return s.processes.some(p=>alive(s,p.name));
}
export async function listSessions() {
  const sessions:Array<Record<string,unknown>>=[];
  for(const root of roots()){
    if(!existsSync(root))continue;
    try{privateDirectory(root);}catch{sessions.push({stateRoot:root,state:'invalid',runId:null,worktree:null,processesAlive:null,verified:false,error:'PREVIEW_STATE_ROOT_UNVERIFIED'});continue;}
    for(const entry of readdirSync(root,{withFileTypes:true})){
      if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
      const base={sessionId:entry.name,stateRoot:root,consumerPath:join(root,entry.name,'consumer.json')};
      try{
        const s=loadAt(root,entry.name);let verified=false;
        const live=processesAlive(s);
        if(s.state==='ready'&&live)try{await verifyConsumer(s);verified=true;}catch{/* 列表不把失活描述为可用。 */}
        const state=verified?'ready':s.state==='stopped'&&!live?'paused':s.state==='ready'||live?'unavailable':s.state;
        sessions.push({...base,runId:s.runId,worktree:s.worktree,state,recordedState:s.state,processesAlive:live,verified,ports:{web:s.ports.web,backend:s.ports.backend,media:s.ports.media}});
      }catch{sessions.push({...base,runId:null,worktree:null,state:'invalid',processesAlive:null,verified:false,error:'PREVIEW_OWNERSHIP_UNVERIFIED'});}
    }
  }
  return {version:1,kind:'wenyou-dev-preview-list',ports:FIXED_PORTS,sessions};
}
export async function assertExclusive(name:string) {
  registerRoot();
  for(const s of (await listSessions()).sessions){
    if(s.stateRoot===stateRoot()&&s.sessionId===name)continue;
    assert(s.processesAlive===false,'PREVIEW_ACTIVE_OR_UNVERIFIED: '+String(s.sessionId||s.stateRoot));
  }
}
export function assertFixed(s:Session){assert(Object.entries(FIXED_PORTS).every(([key,value])=>s.ports[key as keyof typeof FIXED_PORTS]===value),'旧会话必须显式 rebind 固定端口');}
