import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function controlRoot() {
  const root=join(userInfo().homedir,'.local/state/wenyousite-dev-control');
  if(!existsSync(root))mkdirSync(root,{recursive:true,mode:0o700});
  const stat=lstatSync(root);
  assert(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700&&realpathSync(root)===root,'开发锁目录归属不符');
  return root;
}
function proc(pid) {
  try {const fields=readFileSync('/proc/'+pid+'/stat','utf8').split(') ').at(-1).split(' ');return {pid:Number(pid),parent:Number(fields[1]),group:Number(fields[2]),started:fields[19],state:fields[0]};}catch{return null;}
}
function boot(){return readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();}
function owner() {
  const file=join(controlRoot(),'heavy-owner.json');
  if(!existsSync(file))return null;
  const st=lstatSync(file);assert(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'重任务登记归属不符');
  return JSON.parse(readFileSync(file,'utf8'));
}
export function inheritedHeavy() {
  const saved=owner();if(!saved||saved.active===false||saved.boot!==boot())return false;
  const ancestor=proc(saved.pid);if(!ancestor||ancestor.started!==saved.started)return false;
  let current=proc(process.pid);const seen=new Set();
  while(current&&!seen.has(current.pid)){if(current.pid===saved.pid)return true;seen.add(current.pid);current=proc(current.parent);}
  return false;
}
function assertNoOrphan() {
  const saved=owner();if(!saved||saved.boot!==boot())return;
  for(const entry of readdirSync('/proc')){
    if(!/^\d+$/.test(entry))continue;const p=proc(entry);
    assert(!p||![saved.group,...(saved.groups||[])].includes(p.group)||['Z','X'].includes(p.state),'先处理已登记重任务遗留进程；不得并发启动');
  }
}
function writeOwner(value){const file=join(controlRoot(),'heavy-owner.json');const temp=file+'.'+process.pid;writeFileSync(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});renameSync(temp,file);}
async function execute(command,args,held=false){
  const child=spawn(command,args,{stdio:'inherit',detached:held});
  if(held){assert(child.pid);writeOwner({pid:process.pid,started:proc(process.pid).started,boot:boot(),group:child.pid,groupStarted:proc(child.pid)?.started,worktree:process.cwd()});}
  const signal=sig=>{if(child.pid)try{process.kill(held?-child.pid:child.pid,sig);}catch{/* 已退出时由 close 收尾。 */}};
  const term=()=>signal('SIGTERM'),interrupt=()=>signal('SIGINT');process.on('SIGTERM',term);process.on('SIGINT',interrupt);
  try{return await new Promise((ok,fail)=>{child.once('error',fail);child.once('close',(code)=>ok(code??1));});}
  finally{process.off('SIGTERM',term);process.off('SIGINT',interrupt);}
}
export async function runHeavy(command,args=[]) {
  if(inheritedHeavy())return execute(command,args);
  return execute('/usr/bin/flock',['--nonblock','--conflict-exit-code','75',join(controlRoot(),'heavy.lock'),process.execPath,fileURLToPath(import.meta.url),'--held',command,...args]);
}
export function registerHeavyGroup(group) {
  assert(inheritedHeavy(),'资源必须先获取重任务锁');
  const saved=owner();saved.groups=[...new Set([...(saved.groups||[]),group])];writeOwner(saved);
}
export async function acquireHeavyLease() {
  if(inheritedHeavy())return async()=>{};
  const helper=spawn('/usr/bin/flock',['--nonblock','--conflict-exit-code','75',join(controlRoot(),'heavy.lock'),process.execPath,fileURLToPath(import.meta.url),'--lease',String(process.pid),proc(process.pid).started],{stdio:['pipe','pipe','inherit']});
  const closed=new Promise(ok=>helper.once('close',ok));
  await new Promise((ok,fail)=>{helper.once('error',fail);helper.stdout.once('data',ok);helper.once('close',()=>fail(new Error('DEV_HEAVY_BUSY')));});
  return async()=>{const saved=owner();if(saved?.pid===process.pid)writeOwner({...saved,active:false});helper.stdin.end();await closed;};
}
function assertHeldLock() {
  assert(realpathSync('/proc/'+process.ppid+'/exe')===realpathSync('/usr/bin/flock'),'只允许 flock 调用内部入口');
  const expected=join(controlRoot(),'heavy.lock');let held=false;
  for(const fd of readdirSync('/proc/'+process.ppid+'/fd'))try{
    if(realpathSync('/proc/'+process.ppid+'/fd/'+fd)===expected&&/FLOCK\s+ADVISORY\s+WRITE/.test(readFileSync('/proc/'+process.ppid+'/fdinfo/'+fd,'utf8')))held=true;
  }catch{/* 其他文件描述符关闭时继续核验登记锁。 */}
  assert(held,'内部入口必须实际持有规范重任务锁');
}
async function main(){const [mode,command,...args]=process.argv.slice(2);if(mode==='--lease'){assertHeldLock();assertNoOrphan();const parent=proc(Number(command));assert(parent&&parent.started===args[0]);writeOwner({pid:parent.pid,started:parent.started,boot:boot(),groups:[],worktree:process.cwd()});process.stdout.write('locked');process.stdin.resume();return;}assert(['--','--held'].includes(mode)&&command,'使用 dev-heavy.mjs -- command args');
  if(mode==='--held'){assertHeldLock();assertNoOrphan();process.exitCode=await execute(command,args,true);}else process.exitCode=await runHeavy(command,args);
  if(process.exitCode===75)console.error(JSON.stringify({error:'DEV_HEAVY_BUSY',detail:'另一个构建或 E2E 正在运行，请等待其完成'}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(()=>{console.error(JSON.stringify({error:'DEV_HEAVY_FAILED',detail:'重任务锁或进程归属核验失败'}));process.exitCode=1;});
